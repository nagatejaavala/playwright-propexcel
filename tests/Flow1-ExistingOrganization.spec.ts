import { test, expect } from '../utils/test';
import {
  confirmCreateTenantUserAndCapturePassword,
  createTenantPasswordCapture,
  resolveTenantCredentials,
  startGmailCredentialPolling,
  getTenantCredentialsFromImap,
} from "../utils/TenantCredentials";
import { saveSharedTenantData } from "../utils/SharedTenantData";
import { EXISTING_ORG_ADMIN } from "../utils/SharedOrgData";
import { FlowPerfTracker, saveFlowPerformance } from "../utils/FlowPerformance";
import { fillInvoiceLineItemWithRentalIncome } from "../utils/InvoiceLineItem";
import {
  buildTenantIdentityAt,
  commitSequentialTenantIdentity,
  fillIndiaPhoneInContactDialog,
  fillIndiaPhoneInLeadForm,
  peekNextExistingOrgTenantIdentity,
} from "../utils/SharedTenantContactData";

function formatMoveInDate(date: Date = new Date()) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${year}-${month}-${day}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const TENANT_NAME_PATTERN = /^tenant(\d+)$/i;

function parseTenantNumber(name: string): number | null {
  const match = name.trim().match(TENANT_NAME_PATTERN);
  return match ? Number(match[1]) : null;
}

async function openContactsManagement(page: import('@playwright/test').Page) {
  await page.goto('https://test.propexcel.com/crm/contacts', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Contacts Management' }).waitFor({ timeout: 30000 });
}

/** Highest tenant{N} visible in CRM after filtering by "tenant". */
async function findHighestTenantNumberInCrm(page: import('@playwright/test').Page): Promise<number> {
  await openContactsManagement(page);
  const search = page.getByRole('combobox', { name: /Search by Contacts/i });
  await search.fill('tenant');
  await page.waitForTimeout(1500);

  let highest = 0;
  const headings = await page.locator('h3').allTextContents();
  for (const text of headings) {
    const number = parseTenantNumber(text);
    if (number !== null) highest = Math.max(highest, number);
  }
  console.log(`CRM scan: highest tenant number found = tenant${highest}`);
  return highest;
}

/** Probe CRM search until a tenant{N} name is not already listed. */
async function findNextAvailableTenantNumberOnCrm(
  page: import('@playwright/test').Page,
  startNumber: number,
  maxProbe = 30,
): Promise<number> {
  await openContactsManagement(page);
  const search = page.getByRole('combobox', { name: /Search by Contacts/i });

  for (let tenantNumber = startNumber; tenantNumber < startNumber + maxProbe; tenantNumber++) {
    const fullName = `tenant${tenantNumber}`;
    await search.fill('');
    await search.fill(fullName);
    await page.waitForTimeout(1200);

    const exactMatch = page.locator('h3').filter({
      hasText: new RegExp(`^${escapeRegExp(fullName)}$`, 'i'),
    });
    const exists = await exactMatch.first().isVisible({ timeout: 3000 }).catch(() => false);
    if (!exists) {
      console.log(`CRM probe: ${fullName} is available`);
      await search.fill('');
      return tenantNumber;
    }
    console.log(`CRM probe: ${fullName} already exists — skipping`);
  }

  throw new Error(`No available tenant number found starting at tenant${startNumber}`);
}

async function resolveNextTenantNumberForExistingOrg(page: import('@playwright/test').Page): Promise<number> {
  const crmHighest = await findHighestTenantNumberInCrm(page);
  const fromFiles = peekNextExistingOrgTenantIdentity(crmHighest);
  return findNextAvailableTenantNumberOnCrm(page, fromFiles.number);
}

type FlowTenantData = {
  fullName: string;
  email: string;
  mobile: string;
  propertyName: string;
  tenantNumber: number;
};

/** Create contact; on duplicate, try tenant{N+1}, tenant{N+2}, … */
async function createContactWithSequentialRetry(
  page: import('@playwright/test').Page,
  data: FlowTenantData,
  startNumber: number,
  maxAttempts = 15,
): Promise<void> {
  let tenantNumber = startNumber;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const tenant = buildTenantIdentityAt(tenantNumber);
    data.fullName = tenant.fullName;
    data.email = tenant.email;
    data.mobile = tenant.mobile;
    data.tenantNumber = tenantNumber;
    data.propertyName = `villa${tenantNumber}`;

    await page.goto('https://test.propexcel.com/crm/contacts', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Contacts Management' }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Create Contact' }).click();
    const createDialog = page.getByRole('dialog', { name: 'Create New Contact' });
    await createDialog.waitFor();
    await createDialog.getByRole('textbox', { name: 'Enter full name' }).fill(data.fullName);
    await createDialog.getByRole('textbox', { name: 'name@example.com' }).fill(data.email);
    await fillIndiaPhoneInContactDialog(createDialog, data.mobile);
    await createDialog.getByRole('combobox', { name: 'Enter nationality' }).click();
    await createDialog.getByRole('textbox', { name: 'Search...' }).fill('indian');
    await page.getByRole('option', { name: 'Indian', exact: true }).click();
    await createDialog.getByRole('button', { name: 'Create Contact' }).click();

    const dialogClosed = await createDialog.waitFor({ state: 'hidden', timeout: 15000 }).then(() => true).catch(() => false);
    if (dialogClosed) {
      console.log(`Contact created: ${data.fullName}`);
      commitSequentialTenantIdentity(tenantNumber);
      await page.getByRole('combobox', { name: /Search by Contacts/i }).fill(data.fullName);
      await page.locator('h3').filter({ hasText: new RegExp(`^${escapeRegExp(data.fullName)}$`, 'i') }).first()
        .waitFor({ timeout: 30000 });
      return;
    }

    const duplicateHint = page.getByText(/already exists|duplicate|email.*taken|contact.*exists/i);
    if (await duplicateHint.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log(`${data.fullName} already exists — trying tenant${tenantNumber + 1}`);
      await page.keyboard.press('Escape');
      await createDialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => undefined);
      const closeBtn = createDialog.getByRole('button', { name: /Close|Cancel/i }).first();
      if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await closeBtn.click();
        await createDialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => undefined);
      }
      tenantNumber += 1;
      continue;
    }

    await page.keyboard.press('Escape');
    await createDialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => undefined);
    throw new Error(`Create Contact failed for ${data.fullName} (not a duplicate hint)`);
  }

  throw new Error(`Could not create a new contact after ${maxAttempts} sequential attempts from tenant${startNumber}`);
}

async function selectRandomFromCombobox(
  page: import('@playwright/test').Page,
  name: string,
) {
  await page.getByRole('combobox', { name }).click();

  let options = page.getByRole('option');
  if ((await options.count()) === 0) {
    options = page.locator('[role="listbox"] [role="option"], [role="listbox"] button');
  }

  await options.first().waitFor({ state: 'visible', timeout: 10000 });
  // Brief settle — list can re-render and detach option nodes
  await page.waitForTimeout(300);
  options = page.getByRole('option');
  if ((await options.count()) === 0) {
    options = page.locator('[role="listbox"] [role="option"], [role="listbox"] button');
  }

  const count = await options.count();
  if (count === 0) {
    throw new Error(`No options found for combobox: ${name}`);
  }

  const index = Math.floor(Math.random() * count);
  const label = ((await options.nth(index).textContent()) || '').trim();
  console.log(`${name} -> [${index + 1}/${count}] ${label}`);

  // Prefer stable re-query by visible text (avoids detached DOM mid-click)
  const byText = page.getByRole('option', { name: label, exact: true }).first();
  if (await byText.isVisible({ timeout: 2000 }).catch(() => false)) {
    await byText.click({ force: true });
  } else {
    await options.nth(index).click({ force: true });
  }

  // Ensure list closed before next combobox
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(200);
}

async function payViaRazorpayNetbanking(
  page: import('@playwright/test').Page,
  context: import('@playwright/test').BrowserContext,
) {
  const razorpayFrame = page.frameLocator('iframe.razorpay-checkout-frame, iframe[src*="razorpay"]').first();
  await razorpayFrame.getByText(/Payment Options|Netbanking|UPI/i).first()
    .waitFor({ state: 'visible', timeout: 30000 });

  async function continuePaymentIfExitPrompt() {
    const continueBtn = razorpayFrame.getByRole('button', { name: /Continue to payment/i });
    if (await continueBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await continueBtn.click();
      await page.waitForTimeout(500);
    }
  }

  await continuePaymentIfExitPrompt();

  // Select Netbanking from sidebar — click label row (avoid Close Checkout / force radio misfires)
  const netbankingLabel = razorpayFrame.getByText('Netbanking', { exact: true });
  await netbankingLabel.waitFor({ state: 'visible', timeout: 15000 });
  await netbankingLabel.click();

  await continuePaymentIfExitPrompt();

  // Netbanking panel — Suggested Banks or bank search list
  const netbankingReady = razorpayFrame.getByText(/Suggested Banks|Search for Banks|Bank of Baroda/i).first();
  if (!await netbankingReady.isVisible({ timeout: 5000 }).catch(() => false)) {
    await razorpayFrame.getByRole('radio', { name: /Netbanking/i }).click();
    await continuePaymentIfExitPrompt();
  }
  await netbankingReady.waitFor({ state: 'visible', timeout: 20000 });

  // Click suggested Bank of Baroda row to open Razorpay test bank page
  const suggestedBankBtn = razorpayFrame
    .getByRole('heading', { name: 'Suggested Banks' })
    .locator('xpath=following::*[@role="button"][contains(., "Bank of Baroda")][1]');

  let bankPage: import('@playwright/test').Page | null = null;
  try {
    [bankPage] = await Promise.all([
      context.waitForEvent('page', { timeout: 60000 }),
      suggestedBankBtn.evaluate((el) => (el as HTMLElement).click()),
    ]);
  } catch {
    // Fallback: click the whole suggested bank row container
    const bankRow = razorpayFrame.getByRole('radio', {
      name: /Bank of Baroda - Retail Banking.*For Individuals/i,
    }).locator('xpath=ancestor::*[@cursor="pointer" or contains(@class,"cursor")][1]');
    try {
      [bankPage] = await Promise.all([
        context.waitForEvent('page', { timeout: 30000 }),
        bankRow.evaluate((el) => (el as HTMLElement).click()),
      ]);
    } catch {
      bankPage = null;
    }
  }

  async function clickSuccessOnAnyPage(): Promise<boolean> {
    const pages = context.pages();
    for (const p of pages) {
      const successBtn = p.getByRole('button', { name: /^Success$/i });
      if (await successBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await successBtn.click({ force: true });
        await p.waitForEvent('close', { timeout: 30000 }).catch(() => undefined);
        return true;
      }
    }
    const frameSuccess = razorpayFrame.getByRole('button', { name: /^Success$/i });
    if (await frameSuccess.isVisible({ timeout: 2000 }).catch(() => false)) {
      await frameSuccess.click({ force: true });
      return true;
    }
    return false;
  }

  if (bankPage) {
    await bankPage.waitForLoadState('domcontentloaded');
    await bankPage.getByRole('button', { name: /^Success$/i }).click({ force: true });
    await bankPage.waitForEvent('close', { timeout: 30000 }).catch(() => undefined);
  } else {
    // Poll — test bank may open in a new tab slightly delayed
    const deadline = Date.now() + 45000;
    let clicked = false;
    while (Date.now() < deadline && !clicked) {
      clicked = await clickSuccessOnAnyPage();
      if (!clicked) await page.waitForTimeout(1000);
    }
    if (!clicked) {
      throw new Error('Razorpay test bank Success button not found after selecting Bank of Baroda');
    }
  }

  await page.bringToFront();
  await expect(page.getByText(/^PAID$/i).first()).toBeVisible({ timeout: 60000 });
}

async function fillLoginFields(
  page: import('@playwright/test').Page,
  orgId: string,
  email: string,
  password: string,
) {
  const org = page.getByRole('textbox', { name: /Organization ID/i }).or(page.locator('#tenantId'));
  const emailField = page.getByRole('textbox', { name: /Email Address/i }).or(page.locator('#email'));
  const passwordField = page.getByRole('textbox', { name: /^Password$/i }).or(page.locator('#password'));
  await org.first().fill(orgId);
  await emailField.first().fill(email);
  await passwordField.first().fill(password);
}

async function openExistingLead(page: import('@playwright/test').Page, fullName: string) {
  const viewLead = page.getByRole('link', { name: /View Lead|Open Lead/i })
    .or(page.getByRole('button', { name: /View Lead/i }));
  if (await viewLead.first().isVisible({ timeout: 3000 }).catch(() => false)) {
    await viewLead.first().click();
    await page.waitForURL(/\/crm\/leads\/(?!create)[^/]+$/, { timeout: 30000 });
    return;
  }
  await page.goto('https://test.propexcel.com/crm/leads', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: /Leads/i }).waitFor({ timeout: 15000 });
  const search = page.getByRole('combobox', { name: /Search/i }).or(page.getByPlaceholder('Search...')).first();
  if (await search.isVisible({ timeout: 5000 }).catch(() => false)) {
    await search.fill(fullName);
    await page.waitForTimeout(1000);
  }
  await page.locator('h3, h4').filter({ hasText: new RegExp(`^${fullName}$`, 'i') }).first().click();
  await page.waitForURL(/\/crm\/leads\/(?!create)[^/]+$/, { timeout: 30000 });
}

async function openExistingDeal(page: import('@playwright/test').Page, fullName: string) {
  const viewDeal = page.getByRole('link', { name: /View Deal|Open Deal|Deal Details/i })
    .or(page.getByRole('button', { name: /View Deal/i }));
  if (await viewDeal.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    await viewDeal.first().click();
    await page.getByRole('heading', { name: 'Deal Details', level: 1 }).waitFor({ timeout: 30000 });
    return;
  }
  await page.goto('https://test.propexcel.com/crm/deals', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: /Deals/i }).first().waitFor({ timeout: 15000 });
  const search = page.getByPlaceholder(/Search/i).first();
  if (await search.isVisible({ timeout: 5000 }).catch(() => false)) {
    await search.fill(fullName);
    await page.waitForTimeout(1000);
  }
  await page.locator('h3, h4, a').filter({ hasText: new RegExp(fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first().click();
  await page.getByRole('heading', { name: 'Deal Details', level: 1 }).waitFor({ timeout: 30000 });
}

async function loginAsTenant(
  page: import('@playwright/test').Page,
  orgId: string,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('https://test.propexcel.com/login', { waitUntil: 'domcontentloaded' });
  await fillLoginFields(page, orgId, email, password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  const invalidCredentials = page.getByText('Invalid credentials');
  const leftLogin = page.waitForURL(
    (url) => url.hostname.includes('test.propexcel.com') && !url.pathname.includes('/login'),
    { timeout: 20000 },
  ).then(() => 'ok' as const).catch(() => null);
  const sawInvalid = invalidCredentials.waitFor({ state: 'visible', timeout: 20000 })
    .then(() => 'invalid' as const).catch(() => null);
  if (await Promise.race([leftLogin, sawInvalid]) === 'ok') return;
  throw new Error(`Tenant login failed for ${email}`);
}

/** Dismiss new-org onboarding tour modal (PropExcel End-to-End Flow) if it appears after login. */
async function dismissEndToEndFlowTour(page: import('@playwright/test').Page) {
  const title = page.getByText(/PropExcel End-to-End Flow/i).first();
  const visible = await title.isVisible({ timeout: 12000 }).catch(() => false);
  if (!visible) return;

  // Prefer Escape (reliable when X has no accessible name)
  await page.keyboard.press('Escape');
  if (!(await title.isVisible({ timeout: 1500 }).catch(() => false))) {
    console.log('Dismissed PropExcel End-to-End Flow tour (Escape)');
    return;
  }

  const dialog = page.getByRole('dialog').filter({ hasText: /PropExcel End-to-End Flow/i }).first();
  const headerRow = page.locator('div').filter({ hasText: /^PropExcel End-to-End Flow$/ }).first();
  const closeBtn = dialog
    .getByRole('button', { name: /close|cancel/i })
    .or(dialog.locator('button[aria-label*="Close" i], button[aria-label*="close" i]'))
    .or(headerRow.locator('button').first())
    .or(title.locator('xpath=following::button[1]'))
    .first();

  if (await closeBtn.count()) {
    await closeBtn.evaluate((el) => (el as HTMLElement).click()).catch(async () => {
      await closeBtn.click({ force: true });
    });
  } else {
    await page.keyboard.press('Escape');
  }

  await title.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => undefined);
  console.log('Dismissed PropExcel End-to-End Flow tour');
}

/** Close Notifications & Announcements overlay if it blocks the UI. */
async function dismissNotificationsModal(page: import('@playwright/test').Page) {
  const title = page.getByText(/Notifications\s*&\s*Announcements/i).first();
  if (!(await title.isVisible({ timeout: 3000 }).catch(() => false))) return;

  const dialog = page.getByRole('dialog').filter({ hasText: /Notifications\s*&\s*Announcements/i }).first();
  const root = (await dialog.isVisible().catch(() => false)) ? dialog : title.locator('xpath=ancestor::div[.//button][1]');
  const closeBtn = root
    .getByRole('button', { name: /close|cancel/i })
    .or(root.locator('button[aria-label*="Close" i]'))
    .or(root.locator('button').filter({ hasText: /^[×x✕]$/i }))
    .first();

  if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await closeBtn.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await title.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => undefined);
  console.log('Dismissed Notifications & Announcements modal');
}

async function logoutAdmin(page: import('@playwright/test').Page, profileHint?: string) {
  const byHint = profileHint
    ? page.getByRole('button', { name: new RegExp(profileHint, 'i') })
    : page.getByRole('button', { name: /Super Admin/i });
  if (await byHint.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    await byHint.first().click();
  } else if (await page.getByRole('button', { name: /Super Admin/i }).first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.getByRole('button', { name: /Super Admin/i }).first().click();
  } else {
    await page.locator('header').getByRole('button').last().click();
  }
  await page.getByText('Logout', { exact: true }).click();
  await page.waitForURL(/\/login/, { timeout: 15000 });
}

/**
 * Submit for Approval (or Approve Deal) then approve Internal Approval step if workflow is enabled.
 */
async function approveDealViaApprovalWorkflow(page: import('@playwright/test').Page) {
  const alreadyApproved = page.getByText(/Deal Won/i)
    .or(page.getByRole('button', { name: 'View Contract' }));
  if (await alreadyApproved.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('Deal already approved — skipping approval workflow');
    return;
  }

  const submitForApproval = page.getByRole('button', { name: /Submit for Approval/i }).first();
  const approveDealBtn = page.getByRole('button', { name: /^Approve Deal$/i }).first();

  if (await submitForApproval.isVisible({ timeout: 8000 }).catch(() => false)) {
    await submitForApproval.click();
    console.log('Clicked Submit for Approval');

    const confirmDialog = page.getByRole('dialog');
    if (await confirmDialog.isVisible({ timeout: 4000 }).catch(() => false)) {
      await confirmDialog.getByRole('button', { name: /Submit|Approve|Confirm|Yes/i }).click();
      await confirmDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => undefined);
    }

    await page.getByText(/Deal property submitted successfully|Approval In Progress|submitted successfully/i)
      .first()
      .waitFor({ state: 'visible', timeout: 20000 })
      .catch(() => undefined);

    const workflowSection = page.getByText(/Approval Workflow/i).first();
    await workflowSection.waitFor({ state: 'visible', timeout: 30000 });
    await workflowSection.scrollIntoViewIfNeeded();
    await page.getByText(/Loading workflow/i).waitFor({ state: 'hidden', timeout: 30000 }).catch(() => undefined);

    const internalApproval = page.locator('div, section, article')
      .filter({ hasText: /Internal Approval/i })
      .filter({ hasText: /Your Action Required|PENDING|Approve/i })
      .first();
    await internalApproval.waitFor({ state: 'visible', timeout: 30000 });
    await internalApproval.scrollIntoViewIfNeeded();

    const approveBtn = internalApproval.getByRole('button', { name: /^Approve$/i })
      .or(page.getByRole('button', { name: /^Approve$/i }))
      .first();
    await approveBtn.waitFor({ state: 'visible', timeout: 15000 });
    await approveBtn.click();
    console.log('Clicked Approve on Internal Approval step');

    // Confirm step (UI shows Approving... + Confirm)
    const confirmApprove = page.getByRole('button', { name: /^Confirm$/i }).first();
    if (await confirmApprove.isVisible({ timeout: 8000 }).catch(() => false)) {
      await confirmApprove.click();
      console.log('Clicked Confirm on approval step');
    }

    await page.getByText(/APPROVED|COMPLETED ON|Create Contract|View Contract/i)
      .first()
      .waitFor({ state: 'visible', timeout: 60000 });
    console.log('Deal approval workflow completed');
    return;
  }

  await approveDealBtn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
  if (!(await approveDealBtn.isVisible({ timeout: 2000 }).catch(() => false))) {
    console.log('No deal approval action available — assuming deal already approved');
    return;
  }
  await approveDealBtn.click();
  console.log('Clicked Approve Deal');
  const confirmDialog = page.getByRole('dialog');
  if (await confirmDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
    await confirmDialog.getByRole('button', { name: /Approve|Confirm|Yes|Submit/i }).click();
    await confirmDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => undefined);
  }
}

test('Flow 1 with Existing Organization — tenant onboarding and rent collection', async ({ page, context }) => {
  const data: FlowTenantData = {
    fullName: '',
    email: '',
    mobile: '',
    propertyName: '',
    tenantNumber: 0,
  };
  const moveInDate = formatMoveInDate();
  const passwordCapture = createTenantPasswordCapture(page);
  let gmailCredentialsPromise: ReturnType<typeof startGmailCredentialPolling> | undefined;
  let tenantPassword: string | undefined;
  const admin = { ...EXISTING_ORG_ADMIN, orgName: 'test' };
  console.log('Move-in date:', moveInDate);
  console.log('Existing org admin login:', { orgId: admin.orgId, email: admin.email, orgName: admin.orgName });

  test.setTimeout(600_000);
  page.setDefaultTimeout(30_000);
  await context.grantPermissions(['geolocation'], { origin: 'https://test.propexcel.com' });
  const perf = new FlowPerfTracker();

  await perf.step('Admin login', async () => {

          await page.goto('https://test.propexcel.com/login', { waitUntil: 'domcontentloaded' });
          await page.getByRole('heading', { name: /Welcome Back/i }).waitFor({ timeout: 30000 });
          await fillLoginFields(page, admin.orgId, admin.email, admin.password);
          await page.getByRole('button', { name: 'Sign In' }).click();
          await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60000 });
          await dismissEndToEndFlowTour(page);
          await dismissNotificationsModal(page);
          await page.goto('https://test.propexcel.com/property/properties', { waitUntil: 'domcontentloaded' });
          await page.getByRole('heading', { name: 'Properties', level: 1 }).waitFor({ timeout: 60000 });
  });

  await perf.step('Create contact', async () => {
          await page.getByRole('button', { name: 'Got it' }).click({ timeout: 5000 }).catch(() => {});
          const nextTenantNumber = await resolveNextTenantNumberForExistingOrg(page);
          console.log(`Resolved next tenant number from CRM + local files: tenant${nextTenantNumber}`);
          await createContactWithSequentialRetry(page, data, nextTenantNumber);
          console.log('Using tenant for flow:', data);
  });

  await perf.step('Create property', async () => {

          await page.goto('https://test.propexcel.com/property/properties', { waitUntil: 'domcontentloaded' });
          await page.getByRole('heading', { name: 'Properties', level: 1 }).waitFor({ timeout: 30000 });
          await page.getByRole('button', { name: '+ Create Property' }).click();
          try {
            await page.waitForURL(/\/property\/properties\/create/, { timeout: 10000 });
          } catch {
            await page.getByRole('button', { name: '+ Create Property' }).click();
            await page.waitForURL(/\/property\/properties\/create/);
          }
          await page.getByRole('heading', { name: 'Create New Property' }).waitFor();

          await page.getByRole('button', { name: /Office \/ Building/ }).click();

          await page.locator("div:nth-of-type(1) > div:nth-of-type(1) > input").click();
          await page.locator("div:nth-of-type(1) > div:nth-of-type(1) > input").fill(data.propertyName);

          await selectRandomFromCombobox(page, 'Select category');

          await selectRandomFromCombobox(page, 'Select property group');

          //await page.locator("div.lg\\:grid-cols-4 input").click();

         // await page.locator("div.lg\\:grid-cols-4 input").fill('3000');
         // await page.locator("div.lg\\:grid-cols-4 input").fill('3000');
          await page.locator("div.lg\\:grid-cols-4 input[type='number']").fill('3000');



          await page.locator("div:nth-of-type(3) > div:nth-of-type(2) > div > div > div").click();

          await page.getByRole('textbox', { name: 'Rental price for Monthly' }).click();

          await page.getByRole('textbox', { name: 'Rental price for Monthly' }).fill('10000');
  });

  await perf.step('CRM contact + lead + deal', async () => {

          await selectRandomFromCombobox(page, 'Select Tax');

          await page.getByRole('button', { name: 'Got it' }).click({ timeout: 5000 }).catch(() => {});
          await page.goto('https://test.propexcel.com/crm/contacts', { waitUntil: 'domcontentloaded' });
          await page.getByRole('heading', { name: 'Contacts Management' }).waitFor();
          await page.getByRole('combobox', { name: /Search by Contacts/i }).fill(data.fullName);
          await page.locator('h3').filter({ hasText: new RegExp(`^${escapeRegExp(data.fullName)}$`, 'i') }).first().waitFor({ timeout: 30000 });

          await page.locator('h3').filter({ hasText: new RegExp(`^${escapeRegExp(data.fullName)}$`, 'i') }).first().click();
          const existingLeadLink = page.getByRole('link', { name: /View Lead|Open Lead|Lead Details/i })
            .or(page.getByRole('button', { name: /View Lead/i }));
          if (await existingLeadLink.first().isVisible({ timeout: 5000 }).catch(() => false)) {
            console.log('Lead already exists for contact — opening existing lead');
            await existingLeadLink.first().click();
            await page.waitForURL(/\/crm\/leads\/(?!create)[^/]+$/, { timeout: 30000 });
          } else {
          const createLeadBtn = page.getByRole('link', { name: /Create Lead/i })
            .or(page.getByRole('button', { name: 'Create Lead' }))
            .first();
          await createLeadBtn.click();
          await Promise.race([
            page.waitForURL(/\/crm\/leads\/create/, { timeout: 30000 }),
            page.getByRole('dialog').filter({ hasText: /Create New Lead/i }).waitFor({ state: 'visible', timeout: 30000 }),
            page.getByRole('heading', { name: /Create New Lead/i }).waitFor({ state: 'visible', timeout: 30000 }),
          ]).catch(async () => {
            await createLeadBtn.click();
            await page.waitForURL(/\/crm\/leads\/create/, { timeout: 30000 });
          });

          const leadDialog = page.getByRole('dialog').filter({ hasText: /Create New Lead/i });
          const leadForm = await leadDialog.isVisible({ timeout: 5000 }).catch(() => false)
            ? leadDialog
            : page.locator('main').last();

          await leadForm.waitFor({ state: 'visible', timeout: 15000 });
          await page.getByRole('heading', { name: /Create New Lead/i }).waitFor({ timeout: 15000 }).catch(() => undefined);

          await fillIndiaPhoneInLeadForm(leadForm, data.mobile);
          const nationality = leadForm.getByRole('combobox', { name: /e\.g\., UAE|nationality/i }).first();
          if (await nationality.isVisible({ timeout: 3000 }).catch(() => false)) {
            await nationality.click();
            const natSearch = page.getByRole('textbox', { name: 'Search...' });
            if (await natSearch.isVisible({ timeout: 2000 }).catch(() => false)) {
              await natSearch.fill('indian');
            }
            const indian = page.getByRole('option', { name: 'Indian', exact: true });
            if (await indian.isVisible({ timeout: 3000 }).catch(() => false)) {
              await indian.click();
            } else {
              await page.keyboard.press('Escape').catch(() => undefined);
            }
          }

          const scrollArea = leadForm.locator('div.overflow-y-auto, div[class*="overflow-y"]').last();
          if (await scrollArea.count()) {
            await scrollArea.evaluate((el) => { el.scrollTop = el.scrollHeight; });
          } else {
            await leadForm.evaluate((el) => { el.scrollTop = el.scrollHeight; }).catch(() => undefined);
          }

          const submitLeadBtn = leadForm.getByRole('button', { name: 'Create', exact: true }).last()
            .or(page.getByRole('button', { name: 'Create', exact: true }).last());
          await submitLeadBtn.scrollIntoViewIfNeeded();
          await expect(submitLeadBtn).toBeVisible();
          await expect(submitLeadBtn).toBeEnabled();
          await submitLeadBtn.click();
          try {
            await page.waitForURL(/\/crm\/leads\/(?!create)[^/]+$/, { timeout: 20000 });
          } catch {
            const duplicateLead = page.getByText(/lead with this email and phone number already exists/i);
            if (await duplicateLead.isVisible({ timeout: 3000 }).catch(() => false)) {
              console.log('Duplicate lead detected — opening existing lead');
              await openExistingLead(page, data.fullName);
            } else {
              await leadForm.press('End').catch(() => undefined);
              await submitLeadBtn.click({ force: true });
              try {
                await page.waitForURL(/\/crm\/leads\/(?!create)[^/]+$/, { timeout: 45000 });
              } catch {
                await openExistingLead(page, data.fullName);
              }
            }
          }
          }
          await page.getByRole('button', { name: 'Convert to Deal' }).waitFor({ timeout: 30000 }).catch(() => undefined);
  });

  await perf.step('Deal property + approval', async () => {

          const convertBtn = page.getByRole('button', { name: 'Convert to Deal' });
          if (await convertBtn.isEnabled({ timeout: 5000 }).catch(() => false)) {
            await convertBtn.click();
            const convertDialog = page.getByRole('dialog', { name: /Convert Lead to Deal/i });
            await convertDialog.waitFor({ state: 'visible', timeout: 15000 });
            const paymentCombo = convertDialog.getByRole('combobox', { name: /payment type|Select payment type/i })
              .or(convertDialog.getByText(/Select payment type/i));
            await paymentCombo.first().click();
            await page.getByRole('option').first().click();
            await convertDialog.getByRole('button', { name: 'Convert to Deal' }).click();
            await convertDialog.waitFor({ state: 'hidden', timeout: 30000 });
          } else {
            console.log('Lead already converted — opening existing deal');
            await openExistingDeal(page, data.fullName);
          }
          if (!page.url().includes('/crm/deals/')) {
            await page.goto('https://test.propexcel.com/crm/deals', { waitUntil: 'domcontentloaded' });
            await page.locator('h4').filter({ hasText: new RegExp(`^${data.fullName}$`, 'i') }).first().click();
          }
          await page.getByRole('heading', { name: 'Deal Details', level: 1 }).waitFor({ timeout: 30000 });

          const addPropertyBtn = page.getByRole('button', { name: 'Add Property' })
            .or(page.getByRole('button', { name: /\+?\s*Add Property/i }))
            .first();
          const propertyOnDeal = page.locator('h4', { hasText: data.propertyName }).first();
          const addEnabled = await addPropertyBtn.isEnabled().catch(() => false);

          if (await propertyOnDeal.isVisible({ timeout: 5000 }).catch(() => false) && !addEnabled) {
            console.log(`Deal already has property — reusing ${data.propertyName}`);
          } else if (await addPropertyBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await addPropertyBtn.click();
            const addPropertyDialog = page.getByRole('dialog', { name: 'Add Property to Deal' });
            await addPropertyDialog.getByRole('combobox', { name: 'Search...' }).fill(data.propertyName);
            const propertyCard = addPropertyDialog.getByRole('heading', { name: data.propertyName });
            if (await propertyCard.isVisible({ timeout: 5000 }).catch(() => false)) {
              await propertyCard.click();
            } else {
              await addPropertyDialog.locator('h3').first().click();
            }
            await addPropertyDialog.getByRole('button', { name: 'Add Property' }).click();
            await addPropertyDialog.waitFor({ state: 'hidden' });
          } else {
            console.log(`Add Property not available — assuming ${data.propertyName} already on deal`);
          }

          const dealPropertyCard = page.locator('h4', { hasText: data.propertyName }).locator('xpath=ancestor::div[contains(@class,"rounded-2xl")]').first();
          const taxCombobox = dealPropertyCard.getByRole('combobox');
          if (await taxCombobox.isVisible({ timeout: 3000 }).catch(() => false)) {
            const taxLabel = await taxCombobox.textContent();
            if (!taxLabel || taxLabel.includes('No selection')) {
              await taxCombobox.click();
              const gstOption = page.getByRole('option', { name: /GST.*18/i }).first()
                .or(page.getByRole('option', { name: 'GST (18%) (18.00%)' }));
              await gstOption.waitFor({ state: 'visible', timeout: 10000 });
              await gstOption.click();
              await dealPropertyCard.getByRole('button', { name: 'Save' }).click();
            }
          }
  });

  await perf.step('Contract + tenant user', async () => {

          await approveDealViaApprovalWorkflow(page);

          let viewContractBtn = page.getByRole('button', { name: 'View Contract' });
          if (!await viewContractBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            const createContractBtn = page.getByRole('button', { name: 'Create Contract' });
            await createContractBtn.waitFor({ state: 'visible', timeout: 15000 });
            await createContractBtn.click();
            const contractDialog = page.getByRole('dialog');
            if (await contractDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
              await contractDialog.getByRole('button', { name: /Create|Confirm|Yes|Submit/i }).click();
            }
            viewContractBtn = page.getByRole('button', { name: 'View Contract' });
            await viewContractBtn.waitFor({ state: 'visible', timeout: 120000 });
          }
          await viewContractBtn.click();
          const closePreview = page.locator('div.fixed button').first();
          if (await closePreview.isVisible({ timeout: 3000 }).catch(() => false)) {
            await closePreview.click();
          }
          if (!page.url().includes('/accounts/contracts/')) {
            await page.getByRole('button', { name: 'View Contract' }).click();
          }
          await page.waitForURL(/\/accounts\/contracts\//, { timeout: 30000 });
          await page.getByRole('tab', { name: 'Contract Summary' }).click().catch(() => undefined);

          const approveContractBtn = page.getByRole('button', { name: 'Approve Contract' });
          const contractActive = page.getByText(/^Active$/i).first();
          if (await approveContractBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
            await approveContractBtn.scrollIntoViewIfNeeded();
            await approveContractBtn.click();
            const approveContractDialog = page.getByRole('dialog');
            if (await approveContractDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
              await approveContractDialog.getByRole('button', { name: /Approve|Confirm|Yes|Submit/i }).click();
            }
            await contractActive.waitFor({ state: 'visible', timeout: 60000 });
            console.log('Contract approved');
          } else if (await contractActive.isVisible({ timeout: 5000 }).catch(() => false)) {
            console.log('Contract already Active — skipping Approve Contract');
          } else {
            throw new Error('Approve Contract button not found and contract is not Active');
          }

          await page.getByRole('tab', { name: 'Action Buttons' }).click();
          await page.getByRole('tabpanel', { name: 'Action Buttons' }).waitFor({ state: 'visible', timeout: 15000 });

          const createTenantUserBtn = page.getByRole('button', { name: /Create Tenant User/i })
            .or(page.locator('button').filter({ has: page.getByRole('heading', { name: /Create Tenant User/i }) }));
          await createTenantUserBtn.first().waitFor({ state: 'visible', timeout: 30000 });
          await createTenantUserBtn.first().click();
          const dialogPassword = await confirmCreateTenantUserAndCapturePassword(page, passwordCapture);
          if (dialogPassword) {
            console.log('Tenant password captured for tenant user');
          }
          if (!passwordCapture.getPassword()) {
            gmailCredentialsPromise = startGmailCredentialPolling(context, data.email, page);
          }
  });

  await perf.step('Move-in + operations', async () => {

          await page.getByRole('tab', { name: 'Action Buttons' }).click();
          await page.getByRole('tabpanel', { name: 'Action Buttons' }).waitFor({ state: 'visible', timeout: 15000 });

          const moveInBtn = page.getByRole('button', { name: /Create Move In Request/i })
            .or(page.locator('button').filter({ has: page.getByRole('heading', { name: /Create Move In Request/i }) }));
          const moveInExists = page.getByText(/Move-in request for contract|Tenant Move-in Date/i).first();
          if (await moveInExists.isVisible({ timeout: 3000 }).catch(() => false)) {
            console.log('Move-in already exists — skipping Create Move In Request');
          } else if (await moveInBtn.first().isVisible({ timeout: 8000 }).catch(() => false)
            && await moveInBtn.first().isEnabled().catch(() => false)) {
            await moveInBtn.first().click();
            const moveInDialog = page.getByRole('dialog', { name: /Create Move-In Date/i });
            await moveInDialog.waitFor({ state: 'visible', timeout: 10000 });
            const dateField = moveInDialog.getByLabel('Tenant Move-in Date');
            await dateField.click();
            await dateField.fill(moveInDate);
            await moveInDialog.getByRole('button', { name: 'Confirm' }).click();
            await moveInDialog.waitFor({ state: 'hidden', timeout: 15000 });
          } else {
            console.log('Create Move In Request not available — skipping');
          }

          await page.goto('https://test.propexcel.com/operations', { waitUntil: 'domcontentloaded' });
          await page.getByRole('heading', { name: /Operations Dashboard/i }).waitFor({ timeout: 15000 });
          await page.getByRole('button', { name: 'Requests', exact: true }).click();
          await page.waitForURL(/\/operations\/requests/, { timeout: 15000 });
  });

  await perf.step('Tenant credentials + login', async () => {

          await page.getByRole('heading', { name: 'Requests' }).waitFor({ timeout: 15000 });
          const latestMoveInRequest = page.getByText(/Move-in request for contract/i).first();
          await latestMoveInRequest.waitFor({ state: 'visible', timeout: 15000 });
          await latestMoveInRequest.click();
          await page.getByRole('button', { name: 'Start Progress' }).click();
          await page.getByRole('button', { name: 'Complete Request' }).click();
          await page.getByRole('button', { name: 'Mark as Completed' }).click();

          await logoutAdmin(page, admin.orgName);
  });

  await perf.step('Admin rent invoice', async () => {

          const tenantCredentials = await resolveTenantCredentials({
            capturedPassword: passwordCapture.getPassword(),
            gmailPromise: gmailCredentialsPromise,
            page,
            context,
            email: data.email,
          });
          tenantPassword = tenantCredentials.password;
          console.log('Tenant credentials:', {
            loginLink: tenantCredentials.loginLink,
            passwordLength: tenantCredentials.password?.length ?? 0,
            source: tenantCredentials.source,
          });

          if (tenantCredentials.password) {
            const loginDeadline = Date.now() + 180_000;
            let loggedIn = false;
            let passwordToUse = tenantCredentials.password;
            const triedPasswords = new Set<string>();

            while (Date.now() < loginDeadline && !loggedIn) {
              triedPasswords.add(passwordToUse);
              try {
                await loginAsTenant(page, admin.orgId, data.email, passwordToUse);
                tenantPassword = passwordToUse;
                loggedIn = true;
              } catch {
                console.log('Tenant login failed — waiting for fresh IMAP credentials');
                const retryCredentials = await getTenantCredentialsFromImap(data.email, 60_000);
                // SendGrid click-tracking links redirect into the tenant portal
                if (retryCredentials.loginLink && triedPasswords.size >= 2) {
                  try {
                    await page.goto(retryCredentials.loginLink, {
                      waitUntil: 'domcontentloaded',
                      timeout: 60000,
                    });
                    await page.waitForURL(
                      (url) => url.hostname.includes('test.propexcel.com') && !url.pathname.includes('/login'),
                      { timeout: 45000 },
                    );
                    loggedIn = true;
                    if (retryCredentials.password) tenantPassword = retryCredentials.password;
                    console.log('Tenant logged in via email login link');
                    break;
                  } catch {
                    // fall through to password retry
                  }
                }
                if (retryCredentials.password && !triedPasswords.has(retryCredentials.password)) {
                  passwordToUse = retryCredentials.password;
                  tenantPassword = retryCredentials.password;
                }
                await page.waitForTimeout(5000);
              }
            }
            if (!loggedIn) {
              throw new Error(`Tenant login failed for ${data.email} after retries`);
            }
          } else if (tenantCredentials.loginLink) {
            await page.goto(tenantCredentials.loginLink, {
              waitUntil: 'domcontentloaded',
              timeout: 60000,
            });
            await page.waitForURL(
              (url) => url.hostname.includes('test.propexcel.com') && !url.pathname.includes('/login'),
              { timeout: 60000 },
            );
          } else {
            throw new Error(`No tenant password available for ${data.email}`);
          }

          const tenantProfile = page.getByRole('button', { name: new RegExp(data.fullName, 'i') });
          if (await tenantProfile.first().isVisible({ timeout: 5000 }).catch(() => false)) {
            await tenantProfile.first().click();
          } else {
            await page.locator('header').getByRole('button').last().click();
          }
          await page.getByText('Logout', { exact: true }).click();
          await page.waitForURL(/\/login/, { timeout: 15000 });

          await fillLoginFields(page, admin.orgId, admin.email, admin.password);
          await page.getByRole('button', { name: 'Sign In' }).click();
          await dismissEndToEndFlowTour(page);
          await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60000 });
  });

  await perf.step('Tenant Razorpay payment', async () => {

          await page.goto('https://test.propexcel.com/accounts/invoices', { waitUntil: 'domcontentloaded' });
          await page.getByRole('heading', { name: /Invoices/i }).waitFor({ timeout: 15000 });
          await page.getByRole('button', { name: /Create Invoice/i }).click();

          await page.getByText('Search and select contact or tenant', { exact: true }).click();
          await page.getByPlaceholder('Search...').fill(data.fullName);

          const tenantOption = page.getByText(new RegExp(`${data.fullName}.*\\(Tenant\\)`, 'i')).first();
          await tenantOption.waitFor({ state: 'visible', timeout: 15000 });
          await tenantOption.click();

          const addLineItemBtn = page.getByRole('button', { name: 'Add Line Item' });
          if (await addLineItemBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await expect(addLineItemBtn).toBeEnabled({ timeout: 15000 });
            await addLineItemBtn.click();
            await fillInvoiceLineItemWithRentalIncome(page, '10000');
          } else {
            await page.locator('button.h-9.rounded-md.px-3.w-full.sm\\:w-auto').click();
            const amountInput = page.getByPlaceholder('0.00');
            await amountInput.fill('10000');
            await amountInput.press('Enter');
            await page.getByRole('button', { name: 'Save' }).click();
          }

          const invoiceCreateResponse = page.waitForResponse(
            (res) =>
              /invoice/i.test(res.url()) &&
              res.request().method() !== 'GET' &&
              res.status() >= 200 &&
              res.status() < 300,
            { timeout: 60000 },
          ).catch(() => null);

          const submitInvoiceBtn = page.getByRole('button', { name: /^Submit for Approval$/i })
            .or(page.getByRole('button', { name: /^Submit$/i }))
            .first();
          await submitInvoiceBtn.click();

          const approvalPreview = page.getByRole('dialog').filter({ hasText: /Approval Process Preview/i });
          if (await approvalPreview.isVisible({ timeout: 8000 }).catch(() => false)) {
            await approvalPreview.getByRole('button', { name: /^Submit for Approval$/i }).click();
            console.log('Confirmed Approval Process Preview → Submit for Approval');
            await approvalPreview.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => undefined);
          }
          await invoiceCreateResponse;

          // Wait until invoice detail / success UI is shown
          await Promise.race([
            page.waitForURL(/\/accounts\/invoices\/\d+/, { timeout: 60000 }),
            page.getByText(/^INV-\d+/i).first().waitFor({ state: 'visible', timeout: 60000 }),
            page.getByRole('button', { name: /Receive Payment/i }).waitFor({ state: 'visible', timeout: 60000 }),
          ]);

          for (let step = 0; step < 5; step++) {
            const receivePayment = page.getByRole('button', { name: /Receive Payment/i }).first();
            if (await receivePayment.isVisible({ timeout: 1500 }).catch(() => false)) break;
            const dueBadge = page.getByText(/^(DUE|Due|APPROVED|Approved)$/i).first();
            if (await dueBadge.isVisible({ timeout: 1500 }).catch(() => false)) break;

            const actionStep = page.locator('div, section, article')
              .filter({ hasText: /Your Action Required|PENDING|Pending/i })
              .filter({ has: page.getByRole('button', { name: /^Approve$/i }) })
              .first();
            const approveBtn = (await actionStep.isVisible({ timeout: 3000 }).catch(() => false))
              ? actionStep.getByRole('button', { name: /^Approve$/i }).first()
              : page.getByRole('button', { name: /^Approve$/i }).first();
            if (!(await approveBtn.isVisible({ timeout: 3000 }).catch(() => false))) break;

            await approveBtn.scrollIntoViewIfNeeded();
            await approveBtn.click();
            console.log(`Clicked Approve on invoice workflow step ${step + 1}`);
            const confirmApprove = page.getByRole('dialog').getByRole('button', {
              name: /^Confirm$|^Approve$|^Yes$/i,
            }).last();
            if (await confirmApprove.isVisible({ timeout: 5000 }).catch(() => false)) {
              await confirmApprove.click();
            }
            await page.waitForTimeout(800);
          }

          // If still Draft, try to publish / submit so tenant can see it
          const draftBadge = page.getByText(/^Draft$/i).first();
          if (await draftBadge.isVisible({ timeout: 3000 }).catch(() => false)) {
            const publishBtn = page.getByRole('button', { name: /Submit for Approval|^Submit$|Publish|Approve|Send|Mark as Due|Issue/i }).first();
            if (await publishBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
              await publishBtn.click();
              const previewAgain = page.getByRole('dialog').filter({ hasText: /Approval Process Preview/i });
              if (await previewAgain.isVisible({ timeout: 5000 }).catch(() => false)) {
                await previewAgain.getByRole('button', { name: /^Submit for Approval$/i }).click();
              }
              await page.getByText(/success|submitted|approved|due/i).first()
                .waitFor({ state: 'visible', timeout: 20000 })
                .catch(() => {});
            }
          }

          // Strong success signals for a tenant-visible invoice
          await expect(
            page.getByText(/^INV-\d+/i).or(page.getByRole('button', { name: /Receive Payment/i })).first(),
          ).toBeVisible({ timeout: 20000 });

          const dueOrPaid = page.getByText(/^(DUE|Due|PAID|Paid)$/i).first();
          if (await dueOrPaid.isVisible({ timeout: 5000 }).catch(() => false)) {
            console.log('Invoice status:', (await dueOrPaid.textContent())?.trim());
          }
          console.log('Invoice created successfully');

          // Logout Super Admin after creating invoice
          await logoutAdmin(page, admin.orgName);

          // Login again as tenant
          if (!tenantPassword) {
            const refreshed = await resolveTenantCredentials({
              capturedPassword: passwordCapture.getPassword(),
              gmailPromise: gmailCredentialsPromise,
              page,
              context,
              email: data.email,
            });
            tenantPassword = refreshed.password;
          }
          if (!tenantPassword) {
            throw new Error(`No tenant password available for second login: ${data.email}`);
          }

          await page.goto('https://test.propexcel.com/login', { waitUntil: 'domcontentloaded' });
          await fillLoginFields(page, admin.orgId, data.email, tenantPassword);
          await page.getByRole('button', { name: 'Sign In' }).click();
          await page.waitForURL(
            (url) => url.hostname.includes('test.propexcel.com') && !url.pathname.includes('/login'),
            { timeout: 60000 },
          );

          // Tenant portal: Invoices → pay online via Razorpay
          await page.goto('https://test.propexcel.com/tenant/invoices', { waitUntil: 'domcontentloaded' });
          await page.getByRole('heading', { name: /Invoices/i }).waitFor({ timeout: 15000 });

          // Prefer sidebar navigation as well
          const invoicesNav = page.getByRole('button', { name: 'Invoices', exact: true });
          if (await invoicesNav.isVisible({ timeout: 3000 }).catch(() => false)) {
            await invoicesNav.click();
            await page.waitForTimeout(1000);
          }

          const clearStatus = page.getByRole('button', { name: /Clear selection/i });
          if (await clearStatus.isVisible({ timeout: 2000 }).catch(() => false)) {
            await clearStatus.click();
          }

          // Wait until invoice card / View is available
          const viewBtn = page.getByRole('button', { name: 'View' })
            .or(page.getByRole('link', { name: 'View' }))
            .or(page.getByText(/^INV-/i))
            .first();
          const invoiceDeadline = Date.now() + 120_000;
          while (Date.now() < invoiceDeadline) {
            if (await viewBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
              break;
            }
            console.log('Tenant invoices: still empty, refreshing...');
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(4000);
          }
          await viewBtn.waitFor({ state: 'visible', timeout: 10000 });
          if (await page.getByRole('button', { name: 'View' }).first().isVisible({ timeout: 2000 }).catch(() => false)) {
            await page.getByRole('button', { name: 'View' }).first().click();
          } else {
            await page.getByText(/^INV-/i).first().click();
          }
          await page.waitForURL(/\/tenant\/invoices\/\d+/, { timeout: 15000 });

          await page.getByRole('button', { name: /Pay Online/i }).click();
          await page.getByRole('button', { name: /Pay with Razorpay/i }).click();

          await payViaRazorpayNetbanking(page, context);
  });


  if (!tenantPassword) {
    throw new Error('Cannot save shared tenant data — password is missing.');
  }

  saveSharedTenantData({
    fullName: data.fullName,
    email: data.email,
    mobile: data.mobile,
    propertyName: data.propertyName,
    password: tenantPassword,
    orgId: admin.orgId,
    moveInDate,
  });

  commitSequentialTenantIdentity(data.tenantNumber);

  passwordCapture.dispose();

  const perfReport = perf.buildReport({
    flow: 'Flow1-ExistingOrganization',
    orgId: admin.orgId,
    orgName: admin.orgName,
    tenantEmail: data.email,
    tenantName: data.fullName,
    note: 'Includes Playwright slowMo delay if enabled in playwright.config.ts',
  });
  perf.logSummary(perfReport);
  saveFlowPerformance('flow1-existing-org-performance', perfReport);
});
