/**
 * Company category — Existing Deal → … Payment (company leads from crm-contacts-leads-company.json)
 */
import { test, expect } from '../../utils/test';
import {
  ensureTenantUserOnContract,
  createTenantPasswordCapture,
  resolveTenantCredentials,
  startGmailCredentialPolling,
  getTenantCredentialsFromImap,
  loginTenantViaEmailLink,
  pollImapForPassword,
} from "../../utils/TenantCredentials";
import { saveSharedTenantDataNewOrgCompany } from "../../utils/SharedTenantData";
import { loadSharedOrgData } from "../../utils/SharedOrgData";
import { loadSharedCrmDataCompany } from "../../utils/SharedCrmData";
import { fillInvoiceLineItemWithRentalIncome } from "../../utils/InvoiceLineItem";
import { approveContractUntilActive, ensureMoveInRequest } from "../../utils/ContractActions";
import { invoiceBilledToSearchName } from "../../utils/CompanyContact";

function formatMoveInDate(date: Date = new Date()) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${year}-${month}-${day}`;
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

  // Select Netbanking from sidebar — click label/row (UPI row can intercept text click)
  const netbankingRow = razorpayFrame.locator('[data-testid="netbanking"], [data-testid="Netbanking"], [data-value="netbanking"]').first()
    .or(razorpayFrame.getByRole('radio', { name: /Netbanking/i }).locator('xpath=ancestor::label[1]'))
    .or(razorpayFrame.getByText('Netbanking', { exact: true }));
  await netbankingRow.first().waitFor({ state: 'visible', timeout: 15000 });
  await netbankingRow.first().click({ force: true }).catch(async () => {
    await netbankingRow.first().evaluate((el) => (el as HTMLElement).click());
  });

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

/** Dismiss new-org onboarding tour modal (PropExcel End-to-End Flow) if it appears after login. */
async function dismissEndToEndFlowTour(page: import('@playwright/test').Page) {
  const popover = page.locator('#driver-popover-content, .driver-popover, [role="dialog"].flow-popover').first();
  const title = page.getByText(/PropExcel End-to-End Flow/i).first();
  const iframeTour = page.locator('iframe[src*="propexcel-end-to-end-flow"]').first();

  const visible =
    (await title.isVisible({ timeout: 8000 }).catch(() => false)) ||
    (await popover.isVisible({ timeout: 1000 }).catch(() => false)) ||
    (await iframeTour.isVisible({ timeout: 1000 }).catch(() => false));
  if (!visible) return;

  // Escape often closes driver.js popovers
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // Click X / Close on popover if still present
  const closeBtn = page.locator(
    '#driver-popover-content button, .driver-popover button, [role="dialog"].flow-popover button',
  ).filter({ hasText: /close|skip|done|×|x/i })
    .or(page.locator('.driver-popover-close-btn, button[aria-label*="Close" i]'))
    .first();

  if (await closeBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await closeBtn.click({ force: true });
  } else if (await popover.isVisible({ timeout: 500 }).catch(() => false)) {
    // Remove overlay via DOM if UI close fails
    await page.evaluate(() => {
      document.querySelectorAll(
        '#driver-popover-content, .driver-popover, .driver-overlay, iframe[src*="propexcel-end-to-end-flow"]',
      ).forEach((el) => el.remove());
      document.body.classList.remove('driver-active', 'driver-fade');
    });
  }

  await title.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
  await popover.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => undefined);
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

/** Click a top-nav module button (Property / Admin / CRM / …) via aria-label — often not "visible" to Playwright. */
async function clickTopNavModule(page: import('@playwright/test').Page, ariaLabel: string) {
  const btn = page.locator(`button[aria-label="${ariaLabel}"]`).first();
  if (await btn.count()) {
    try {
      await btn.waitFor({ state: 'attached', timeout: 8000 });
      await btn.evaluate((el) => (el as HTMLElement).click());
      return;
    } catch {
      // Fall through to URL navigation
    }
  }
  const fallbacks: Record<string, string> = {
    Accounts: 'https://test.propexcel.com/accounts',
    CRM: 'https://test.propexcel.com/crm/contacts',
    Property: 'https://test.propexcel.com/property/properties',
    Admin: 'https://test.propexcel.com/admin',
    Settings: 'https://test.propexcel.com/admin/settings',
  };
  const url = fallbacks[ariaLabel];
  if (!url) throw new Error(`Top nav module not found: ${ariaLabel}`);
  console.log(`Top nav "${ariaLabel}" not found — navigating to ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}

/**
 * Deal property card: if rent is 0, set random rent (120000–600000), discount (10–30%),
 * select tax, Save → Mark as site visit → Submit for Approval.
 * Skips fields that are already filled or disabled (prior-run / submitted deal).
 */
async function fillDealPropertyPricingAndSubmit(page: import('@playwright/test').Page, propertyName: string) {
  // Already past pricing / approval?
  if (await page.getByRole('button', { name: /Create Contract|View Contract/i }).first()
    .isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('Deal already approved / contract available — skipping pricing submit');
    return;
  }
  if (await page.getByRole('button', { name: /^Approve$/i }).first()
    .isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('Approve already available — skipping pricing submit');
    return;
  }

  const propertyCard = page.locator('h4', { hasText: propertyName })
    .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")]').first()
    .or(page.locator('div.rounded-2xl').filter({ hasText: propertyName }).first());
  await propertyCard.waitFor({ state: 'visible', timeout: 15000 });
  await propertyCard.scrollIntoViewIfNeeded();

  // PROPERTY RENT
  const rentInput = propertyCard.getByRole('spinbutton', { name: /PROPERTY RENT|Property Rent/i })
    .or(propertyCard.getByLabel(/PROPERTY RENT|Property Rent/i))
    .or(propertyCard.locator('input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]').first())
    .first();
  await rentInput.waitFor({ state: 'visible', timeout: 10000 });
  const rentRaw = ((await rentInput.inputValue().catch(() => '0')) || '0').replace(/,/g, '').trim();
  const rentValue = Number(rentRaw) || 0;
  const rentEnabled = await rentInput.isEnabled().catch(() => false);
  if (rentValue === 0 && rentEnabled) {
    const rent = Math.floor(120000 + Math.random() * (600000 - 120000 + 1));
    await rentInput.click();
    await rentInput.fill('');
    await rentInput.fill(String(rent));
    console.log('Set property rent:', rent);
  } else {
    console.log(`Property rent already set/disabled: ${rentValue} (enabled=${rentEnabled})`);
  }

  // DISCOUNT (%) — 10 to 30 (skip if disabled)
  const discount = Math.floor(10 + Math.random() * (30 - 10 + 1));
  const discountInput = propertyCard.getByRole('spinbutton', { name: /DISCOUNT\s*\(%\)|Discount\s*\(%\)/i })
    .or(propertyCard.getByLabel(/DISCOUNT\s*\(%\)|Discount\s*\(%\)/i))
    .or(propertyCard.locator('input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]').nth(1))
    .first();
  if (await discountInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    if (await discountInput.isEnabled().catch(() => false)) {
      await discountInput.click();
      await discountInput.fill('');
      await discountInput.fill(String(discount));
      console.log('Set discount %:', discount);
    } else {
      const existingDiscount = ((await discountInput.inputValue().catch(() => '')) || '').trim();
      console.log(`Discount disabled — keeping existing value: ${existingDiscount}`);
    }
  }

  // TAX % dropdown — always select GST (18%) when editable
  const taxCombobox = propertyCard.getByRole('combobox').first();
  if (await taxCombobox.isVisible({ timeout: 5000 }).catch(() => false)) {
    const taxEnabled = await taxCombobox.isEnabled().catch(() => true);
    const taxLabel = ((await taxCombobox.textContent()) || '').trim();
    if (taxEnabled && (!taxLabel || /No selection/i.test(taxLabel) || !/GST\s*\(\s*18\s*%\s*\)/i.test(taxLabel))) {
      await taxCombobox.click();
      const taxOption = page.getByRole('option', { name: /GST\s*\(\s*18\s*%\s*\)/i }).first()
        .or(page.getByRole('option', { name: /GST.*18|18\.00%/i }).first());
      await taxOption.waitFor({ state: 'visible', timeout: 15000 });
      await taxOption.click();
      console.log('Selected deal property tax: GST (18%)');
    } else {
      console.log(`Tax already set/disabled: ${taxLabel}`);
    }
  }

  const saveBtn = propertyCard.getByRole('button', { name: /^Save$/i });
  if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)
    && await saveBtn.isEnabled().catch(() => false)) {
    await saveBtn.click();
    await page.getByText(/saved|success|updated/i).first().waitFor({ timeout: 10000 }).catch(() => undefined);
    console.log('Deal property pricing saved');
  } else {
    console.log('Save not available — pricing likely already locked');
  }

  // Checkbox label is "Site visit done" / "Mark as Site visit done" — may already be checked+disabled
  const alreadySiteVisited = await page.getByText(/^Site visit done$/i).first()
    .isVisible({ timeout: 2000 })
    .catch(() => false);
  const siteVisitCheckbox = page.getByRole('checkbox', { name: /Site visit/i }).first();

  if (alreadySiteVisited || (await siteVisitCheckbox.isChecked().catch(() => false))) {
    console.log('Site visit already marked done — skipping');
  } else if (await siteVisitCheckbox.isVisible({ timeout: 5000 }).catch(() => false)) {
    await siteVisitCheckbox.check({ force: true }).catch(async () => {
      await page.getByText(/Site visit done/i).first().click({ force: true });
    });
    console.log('Marked as site visit done');
  } else {
    const siteVisitBtn = page.getByRole('button', { name: /Mark as site visit/i }).first();
    if (await siteVisitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await siteVisitBtn.click();
      console.log('Clicked Mark as site visit');
    }
  }

  // Submit is handled in approveDealViaApprovalWorkflow (avoids double-click before confirm)
}

/**
 * After Submit for Approval: scroll to Approval Workflow → Internal Approval → Approve.
 * Matches PropExcel deal page when Deal Approve workflow is enabled.
 */
async function closeWorkflowPreview(page: import('@playwright/test').Page) {
  const preview = page.getByRole('dialog').filter({ hasText: /Workflow preview|Not yet initiated/i }).first();
  if (await preview.isVisible({ timeout: 1500 }).catch(() => false)) {
    await preview.getByRole('button', { name: /Close/i }).click();
    await preview.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => undefined);
    console.log('Closed workflow preview dialog');
  }
}

async function confirmSubmitDialog(page: import('@playwright/test').Page) {
  const modal = page.getByRole('dialog').filter({ hasNotText: /Workflow preview|Not yet initiated/i }).first();
  if (await modal.isVisible({ timeout: 4000 }).catch(() => false)) {
    const confirm = modal.getByRole('button', {
      name: /Submit for Approval|^Submit$|^Approve$|^Confirm$|^Yes$|Initiate|Continue/i,
    }).last();
    if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirm.click();
      console.log('Confirmed Submit for Approval dialog');
    }
    await modal.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => undefined);
  }
}

async function approveDealViaApprovalWorkflow(page: import('@playwright/test').Page) {
  await dismissEndToEndFlowTour(page);
  await dismissNotificationsModal(page);

  if (await page.getByRole('button', { name: /Create Contract|View Contract/i }).first()
    .isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('Deal already approved — skipping approval workflow');
    return;
  }

  const approveDealBtn = page.getByRole('button', { name: /^Approve Deal$/i }).first();

  for (let attempt = 1; attempt <= 3; attempt++) {
    const approveReady = page.getByRole('button', { name: /^Approve$/i }).first();
    if (await approveReady.isVisible({ timeout: 2000 }).catch(() => false)) break;

    const submitForApproval = page.getByRole('button', { name: /^Submit for Approval$/i }).first();
    if (await submitForApproval.isVisible({ timeout: 5000 }).catch(() => false)) {
      await closeWorkflowPreview(page);
      await submitForApproval.scrollIntoViewIfNeeded();
      await submitForApproval.click();
      console.log(`Clicked Submit for Approval (attempt ${attempt})`);
      await confirmSubmitDialog(page);
      await page.getByText(/Deal property submitted successfully|IN PROGRESS|Approval In Progress/i)
        .first()
        .waitFor({ timeout: 10000 })
        .catch(() => undefined);
      await page.waitForTimeout(1500);
      continue;
    }

    if (await approveDealBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await approveDealBtn.click();
      console.log('Clicked Approve Deal');
      await confirmSubmitDialog(page);
      break;
    }
  }

  await closeWorkflowPreview(page);

  const workflowSection = page.getByText(/Approval Workflow/i).first();
  await workflowSection.waitFor({ state: 'visible', timeout: 30000 });
  await workflowSection.scrollIntoViewIfNeeded();
  await page.getByText(/Loading workflow/i).waitFor({ state: 'hidden', timeout: 30000 }).catch(() => undefined);

  const internalApproval = page.locator('div, section, article')
    .filter({ hasText: /Internal Approval/i })
    .filter({ hasText: /Your Action Required|PENDING|Approve/i })
    .first();
  await internalApproval.waitFor({ state: 'visible', timeout: 30000 }).catch(() => undefined);
  await internalApproval.scrollIntoViewIfNeeded().catch(() => undefined);

  const approveBtn = internalApproval.getByRole('button', { name: /^Approve$/i })
    .or(page.getByRole('button', { name: /^Approve$/i }))
    .first();
  await approveBtn.waitFor({ state: 'visible', timeout: 30000 });
  await approveBtn.scrollIntoViewIfNeeded();
  await approveBtn.click();
  console.log('Clicked Approve on Internal Approval step');

  const confirmApprove = page.getByRole('button', { name: /^Confirm$/i }).first();
  if (await confirmApprove.isVisible({ timeout: 8000 }).catch(() => false)) {
    await confirmApprove.click();
    console.log('Clicked Confirm on approval step');
  }

  await page.getByText(/APPROVED|COMPLETED ON|Create Contract|View Contract/i)
    .first()
    .waitFor({ state: 'visible', timeout: 60000 });
  console.log('Deal approval workflow completed');
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

test('Company Category — Existing Deal → Contract → Tenant → Invoice → Receive Payment', async ({ page, context }) => {
  const propertyName = `villa${Date.now().toString().slice(-6)}`;
  const data = { fullName: '', companyName: '' as string | undefined, email: '', mobile: '', propertyName };
  const moveInDate = formatMoveInDate();
  const passwordCapture = createTenantPasswordCapture(page);
  let gmailCredentialsPromise: ReturnType<typeof startGmailCredentialPolling> | undefined;
  let tenantPassword: string | undefined;
  const admin = loadSharedOrgData();
  const crm = loadSharedCrmDataCompany();
  if (!crm.leads.length) {
    throw new Error('No leads in SharedCrmData — run Creating Contacts,Leads,Deals.spec.ts first (deals created from leads).');
  }
  const sharedDeal = crm.leads[Math.floor(Math.random() * crm.leads.length)];
  data.fullName = sharedDeal.fullName;
  data.companyName = sharedDeal.companyName;
  data.email = sharedDeal.email;
  data.mobile = sharedDeal.mobile;
  console.log('Run data (existing deal from SharedCrmData lead):', data, 'Move-in date:', moveInDate);
  console.log('Existing Deal→Payment admin login (from CreateOrganization org.json):', {
    orgId: admin.orgId,
    email: admin.email,
    orgName: admin.orgName,
  });
  console.log('Picked shared CRM lead/deal:', sharedDeal);

  test.setTimeout(600_000);
  page.setDefaultTimeout(30_000);
  await context.grantPermissions(['geolocation'], { origin: 'https://test.propexcel.com' });
      {

          await page.goto('https://test.propexcel.com/login', { waitUntil: 'domcontentloaded' });
          await page.getByRole('heading', { name: /Welcome Back/i }).waitFor({ timeout: 30000 });
          await fillLoginFields(page, admin.orgId, admin.email, admin.password);
          await page.getByRole('button', { name: 'Sign In' }).click();
          await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60000 });
          await dismissEndToEndFlowTour(page);
          await dismissNotificationsModal(page);
      }
      {
          // Deals list cards are titled with person fullName (not company name)
          const escapedName = sharedDeal.fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const nameRe = new RegExp(escapedName, 'i');

          try {
            await clickTopNavModule(page, 'CRM');
            await page.getByRole('button', { name: /^Deals$/i })
              .or(page.getByRole('link', { name: /^Deals$/i }))
              .first()
              .click({ timeout: 10000 });
          } catch {
            await page.goto('https://test.propexcel.com/crm/deals', { waitUntil: 'domcontentloaded' });
          }
          await page.getByRole('heading', { name: /Deals/i }).first().waitFor({ timeout: 30000 });
          await dismissEndToEndFlowTour(page);

          const dealSearch = page.getByPlaceholder(/Search/i).first()
            .or(page.getByRole('combobox', { name: /Search/i }).first());
          if (await dealSearch.isVisible({ timeout: 5000 }).catch(() => false)) {
            await dealSearch.fill(sharedDeal.fullName);
            await page.waitForTimeout(1000);
          }

          const dealCard = page.locator('h3, h4, a').filter({ hasText: nameRe }).first();
          await dealCard.waitFor({ state: 'visible', timeout: 30000 });
          await dealCard.click();
          await page.getByRole('heading', { name: 'Deal Details', level: 1 }).waitFor({ timeout: 30000 });
          console.log('Opened existing deal for:', sharedDeal.fullName);
      }
      {

          const addPropertyBtn = page.getByRole('button', { name: 'Add Property' })
            .or(page.getByRole('button', { name: /\+?\s*Add Property/i }))
            .first();
          const propertyOnDeal = page.locator('div.rounded-2xl').filter({ hasText: /PROPERTY RENT|Property Rent/i }).first();
          const addEnabled = await addPropertyBtn.isEnabled().catch(() => false);

          if (await propertyOnDeal.isVisible({ timeout: 5000 }).catch(() => false) && !addEnabled) {
            const nameEl = propertyOnDeal.locator('h4').first();
            data.propertyName = ((await nameEl.textContent()) || '').trim() || data.propertyName;
            console.log('Deal already has property (Add Property disabled):', data.propertyName);
          } else {
            await addPropertyBtn.waitFor({ state: 'visible', timeout: 15000 });
            await addPropertyBtn.click();
            const addPropertyDialog = page.getByRole('dialog', { name: /Add Property to Deal/i });
            await addPropertyDialog.waitFor({ state: 'visible', timeout: 15000 });

            const statusCombo = addPropertyDialog.getByRole('combobox', { name: /Status/i })
              .or(addPropertyDialog.getByRole('combobox').filter({ hasText: /All \(Status\)|Vacant/i }))
              .last();
            await statusCombo.click();
            await page.getByRole('option', { name: /^Vacant$/i }).click();
            console.log('Add Property status filter -> Vacant');
            await page.waitForTimeout(800);

            const vacantCards = addPropertyDialog.locator('h3');
            await vacantCards.first().waitFor({ state: 'visible', timeout: 15000 });
            const count = await vacantCards.count();
            const index = Math.floor(Math.random() * count);
            const existingProperty = vacantCards.nth(index);
            data.propertyName = ((await existingProperty.textContent()) || '').trim() || data.propertyName;
            console.log(`Selected vacant property for deal: ${data.propertyName} [${index + 1}/${count}]`);
            await existingProperty.click();

            const confirmAdd = addPropertyDialog.getByRole('button', { name: /^Add Property$/i });
            await expect(confirmAdd).toBeEnabled({ timeout: 15000 });
            await confirmAdd.click();
            await addPropertyDialog.waitFor({ state: 'hidden' });
          }
      }
      {
          await fillDealPropertyPricingAndSubmit(page, data.propertyName);
      }
      {
          await approveDealViaApprovalWorkflow(page);
      }
      {

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
      }
      {

          await approveContractUntilActive(page);
      }
      {

          const dialogPassword = await ensureTenantUserOnContract(page, passwordCapture);
          if (dialogPassword) {
            console.log('Tenant password captured for tenant user');
          }
          if (!passwordCapture.getPassword()) {
            gmailCredentialsPromise = startGmailCredentialPolling(context, data.email, page);
          }
      }
      {

          await ensureMoveInRequest(page, moveInDate);
      }
      {

          await page.goto('https://test.propexcel.com/operations', { waitUntil: 'domcontentloaded' });
          await page.getByRole('heading', { name: /Operations Dashboard/i }).waitFor({ timeout: 15000 });
          await page.getByRole('button', { name: 'Requests', exact: true }).click();
          await page.waitForURL(/\/operations\/requests/, { timeout: 15000 });
      }
      {

          await page.getByRole('heading', { name: 'Requests' }).waitFor({ timeout: 15000 });
          const latestMoveInRequest = page.getByText(/Move-in request for contract/i).first();
          await latestMoveInRequest.waitFor({ state: 'visible', timeout: 15000 });
          await latestMoveInRequest.click();
          await page.getByRole('button', { name: 'Start Progress' }).click();
          await page.getByRole('button', { name: 'Complete Request' }).click();
          await page.getByRole('button', { name: 'Mark as Completed' }).click();
      }
      {

          await logoutAdmin(page, admin.orgName);
      }
      {

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
            await page.goto('https://test.propexcel.com/login', { waitUntil: 'domcontentloaded' });
            await fillLoginFields(page, admin.orgId, data.email, tenantCredentials.password);
            await page.getByRole('button', { name: 'Sign In' }).click();

            const invalidCredentials = page.getByText('Invalid credentials');
            const leftLogin = page.waitForURL(
              (url) => url.hostname.includes('test.propexcel.com') && !url.pathname.includes('/login'),
              { timeout: 15000 },
            ).then(() => 'ok' as const).catch(() => null);
            const sawInvalid = invalidCredentials.waitFor({ state: 'visible', timeout: 15000 })
              .then(() => 'invalid' as const).catch(() => null);
            const loginResult = await Promise.race([leftLogin, sawInvalid]);

            if (loginResult === 'invalid') {
              console.log('Login failed — retrying with fresh IMAP fetch');
              const retryCredentials = await getTenantCredentialsFromImap(data.email, 120_000);
              tenantPassword = retryCredentials.password;
              const passwordField = page.getByRole('textbox', { name: /^Password$/i }).or(page.locator('#password'));
              await passwordField.first().fill('');
              await passwordField.first().fill(retryCredentials.password!);
              await page.getByRole('button', { name: 'Sign In' }).click();
            }
          } else if (tenantCredentials.loginLink) {
            await loginTenantViaEmailLink(page, tenantCredentials.loginLink);
            console.log('Tenant logged in via email login link');
            if (!tenantPassword) {
              tenantPassword = await pollImapForPassword(data.email, 90_000);
            }
          } else {
            throw new Error(`No tenant password available for ${data.email}`);
          }
      }
      {

          const tenantProfile = page.getByRole('button', { name: new RegExp(data.fullName, 'i') });
          if (await tenantProfile.first().isVisible({ timeout: 5000 }).catch(() => false)) {
            await tenantProfile.first().click();
          } else {
            await page.locator('header').getByRole('button').last().click();
          }
          await page.getByText('Logout', { exact: true }).click();
          await page.waitForURL(/\/login/, { timeout: 15000 });
      }
      {

          await fillLoginFields(page, admin.orgId, admin.email, admin.password);
          await page.getByRole('button', { name: 'Sign In' }).click();
          await dismissEndToEndFlowTour(page);
          await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60000 });
      }
      {

          await page.goto('https://test.propexcel.com/accounts/invoices', { waitUntil: 'domcontentloaded' });
          await page.getByRole('heading', { name: /Invoices/i }).waitFor({ timeout: 15000 });
          await page.getByRole('button', { name: /Create Invoice/i }).click();

          await page.getByText('Search and select contact or tenant', { exact: true }).click();
          const billedToName = invoiceBilledToSearchName(data);
          await page.getByPlaceholder('Search...').fill(billedToName);

          const billedToEscaped = billedToName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const tenantOption = page.getByText(new RegExp(`${billedToEscaped}.*\\(Tenant\\)`, 'i')).first();
          await tenantOption.waitFor({ state: 'visible', timeout: 15000 });
          await tenantOption.click();

          const addLineItemBtn = page.getByRole('button', { name: 'Add Line Item' });
          if (await addLineItemBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
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
            { timeout: 30000 },
          ).catch(() => null);

          await page.getByRole('button', { name: 'Submit' }).click();
          await invoiceCreateResponse;

          // Wait until invoice detail / success UI is shown
          await Promise.race([
            page.waitForURL(/\/accounts\/invoices\/\d+/, { timeout: 30000 }),
            page.getByText(/^INV-\d+/i).first().waitFor({ state: 'visible', timeout: 30000 }),
            page.getByRole('button', { name: /Receive Payment/i }).waitFor({ state: 'visible', timeout: 30000 }),
          ]);

          // If still Draft, try to publish / submit so tenant can see it
          const draftBadge = page.getByText(/^Draft$/i).first();
          if (await draftBadge.isVisible({ timeout: 3000 }).catch(() => false)) {
            const publishBtn = page.getByRole('button', { name: /Submit|Publish|Approve|Send|Mark as Due|Issue/i }).first();
            if (await publishBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
              await publishBtn.click();
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
      }
      {

          // Logout Super Admin after creating invoice
          await logoutAdmin(page, admin.orgName);
      }
      {

          // Login again as tenant
          let secondLoginViaLink = false;
          if (!tenantPassword) {
            const refreshed = await resolveTenantCredentials({
              capturedPassword: passwordCapture.getPassword(),
              gmailPromise: gmailCredentialsPromise,
              page,
              context,
              email: data.email,
            });
            tenantPassword = refreshed.password ?? await pollImapForPassword(data.email, 90_000);
            if (!tenantPassword && refreshed.loginLink) {
              await loginTenantViaEmailLink(page, refreshed.loginLink);
              secondLoginViaLink = true;
              tenantPassword = await pollImapForPassword(data.email, 60_000);
            }
          }
          if (!secondLoginViaLink) {
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
          }
      }
      {

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
      }

  if (!tenantPassword) {
    tenantPassword = await pollImapForPassword(data.email, 120_000);
  }
  if (!tenantPassword) {
    throw new Error('Cannot save shared tenant data — password is missing.');
  }

  saveSharedTenantDataNewOrgCompany({
    fullName: data.fullName,
    companyName: data.companyName,
    email: data.email,
    mobile: data.mobile,
    propertyName: data.propertyName,
    password: tenantPassword,
    orgId: admin.orgId,
    moveInDate,
  });

  passwordCapture.dispose();
});
