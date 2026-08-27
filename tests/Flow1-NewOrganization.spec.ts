import { test, expect } from "@playwright/test";
import {
  captureTenantPasswordFromDialog,
  createTenantPasswordCapture,
  getTenantCredentialsFromYopmail,
  resolveTenantCredentials,
  startYopmailCredentialPolling,
} from "../utils/TenantCredentials";
import { saveSharedTenantDataNewOrg } from "../utils/SharedTenantData";
import { loadSharedOrgData } from "../utils/SharedOrgData";

function generateTestData() {
  const suffix = Date.now().toString().slice(-6);
  return {
    fullName: `user${suffix}`,
    email: `user${suffix}@yopmail.com`,
    mobile: `9${Math.floor(100000000 + Math.random() * 900000000)}`,
    propertyName: `villa${suffix}`,
  };
}

function formatMoveInDate(date: Date = new Date()) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${year}-${month}-${day}`;
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

/** Click a top-nav module button (Property / Admin / …) via aria-label — often not "visible" to Playwright. */
async function clickTopNavModule(page: import('@playwright/test').Page, ariaLabel: string) {
  const btn = page.locator(`button[aria-label="${ariaLabel}"]`).first();
  await btn.waitFor({ state: 'attached', timeout: 15000 });
  await btn.evaluate((el) => (el as HTMLElement).click());
}

/** Configure Razorpay under Admin → Integrations (needed for new orgs before rent payment). */
async function configureRazorpayIntegration(page: import('@playwright/test').Page) {
  await dismissEndToEndFlowTour(page);
  await dismissNotificationsModal(page);

  // Top-nav Admin module (gear) → left sidebar Integrations → Razorpay
  try {
    await clickTopNavModule(page, 'Admin');
  } catch {
    await clickTopNavModule(page, 'Settings').catch(() => undefined);
  }
  await dismissEndToEndFlowTour(page);
  await dismissNotificationsModal(page);

  // Wait for Admin sidebar (Employees / Integrations)
  await page.getByRole('button', { name: /^Employees$/i })
    .or(page.getByRole('button', { name: /^Integrations$/i }))
    .or(page.getByText(/^Admin$/i))
    .first()
    .waitFor({ state: 'visible', timeout: 15000 })
    .catch(() => undefined);

  const integrationsNav = page.getByRole('button', { name: /^Integrations$/i })
    .or(page.getByRole('link', { name: /^Integrations$/i }))
    .first();
  if (await integrationsNav.isVisible({ timeout: 8000 }).catch(() => false)) {
    await integrationsNav.click({ timeout: 20000 });
  } else {
    await page.goto('https://test.propexcel.com/admin/integrations', { waitUntil: 'domcontentloaded' });
  }

  await page.getByRole('link', { name: /^Razorpay$/i })
    .or(page.getByRole('button', { name: /^Razorpay$/i }))
    .or(page.getByRole('tab', { name: /^Razorpay$/i }))
    .or(page.getByText(/^Razorpay$/i))
    .first()
    .click();

  const keyId = page.getByLabel(/Razorpay\s*Key\s*ID/i)
    .or(page.getByRole('textbox', { name: /Razorpay\s*Key\s*ID/i }))
    .or(page.getByPlaceholder(/Key ID|rzp_/i))
    .first();
  const keySecret = page.getByLabel(/Razorpay\s*Key\s*Secret/i)
    .or(page.getByRole('textbox', { name: /Razorpay\s*Key\s*Secret/i }))
    .or(page.getByPlaceholder(/Key Secret|secret/i))
    .first();

  await keyId.waitFor({ state: 'visible', timeout: 15000 });
  await keyId.fill('');
  await keyId.fill('rzp_test_Strt5pbr1bvoIR');
  await keySecret.fill('');
  await keySecret.fill('TOOPnInaNRdn7Sn1FuXnNVTz');

  await page.getByRole('button', { name: /Save Settings/i }).click();
  await page.getByText(/saved|success|updated/i).first().waitFor({ timeout: 10000 }).catch(() => undefined);
  console.log('Razorpay integration settings saved');
}

/**
 * Accounts → Account Settings → Taxes → GST 18%.
 * Delete default VAT if present; skip create when GST (18%) already exists.
 */
async function configureTaxSettings(page: import('@playwright/test').Page) {
  await dismissEndToEndFlowTour(page);
  await dismissNotificationsModal(page);

  await clickTopNavModule(page, 'Accounts');
  await dismissEndToEndFlowTour(page);

  // Account Settings → Taxes Manage (video path); fall back to /accounts/taxes
  const accountSettings = page.getByRole('button', { name: /^Account Settings$/i })
    .or(page.getByRole('link', { name: /^Account Settings$/i }))
    .first();
  if (await accountSettings.isVisible({ timeout: 8000 }).catch(() => false)) {
    await accountSettings.click();
    await page.getByRole('heading', { name: /Accounts? Settings/i }).waitFor({ timeout: 20000 });

    const taxesCard = page.locator('div')
      .filter({ hasText: /Taxes/i })
      .filter({ hasText: /Configure tax rates|tax settings/i })
      .first();
    if (await taxesCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await taxesCard.getByRole('button', { name: /Manage/i }).click();
    } else {
      await page.goto('https://test.propexcel.com/accounts/taxes', { waitUntil: 'domcontentloaded' });
    }
  } else {
    await page.goto('https://test.propexcel.com/accounts/taxes', { waitUntil: 'domcontentloaded' });
  }

  await page.getByRole('heading', { name: /^Taxes$/i }).waitFor({ timeout: 30000 });

  // Delete default VAT if present (do not edit it into GST)
  const vatRow = page.getByRole('row').filter({ hasText: /\bVAT\b/i }).first();
  if (await vatRow.isVisible({ timeout: 5000 }).catch(() => false)) {
    const deleteBtn = vatRow.getByRole('button', { name: /Delete/i })
      .or(vatRow.locator('button[aria-label*="Delete" i]'))
      .or(vatRow.locator('button').last());
    await deleteBtn.click({ force: true });
    const confirmDelete = page.getByRole('dialog').getByRole('button', { name: /Delete|Confirm|Yes/i }).first()
      .or(page.getByRole('button', { name: /Delete|Confirm|Yes/i }).last());
    if (await confirmDelete.isVisible({ timeout: 4000 }).catch(() => false)) {
      await confirmDelete.click();
    }
    await vatRow.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => undefined);
    console.log('Deleted existing VAT tax');
  }

  const gstRow = page.getByRole('row').filter({ hasText: /GST\s*\(\s*18\s*%\s*\)|GST-18/i }).first();
  if (await gstRow.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('GST (18%) already configured — skipping tax create');
  } else {
    await page.getByRole('button', { name: /\+?\s*Create New Tax/i }).first().click();
    console.log('Creating new tax GST (18%)');

    await page.getByRole('heading', { name: /Create New Tax|Create.*Tax|New Tax|Tax Information/i })
      .first()
      .waitFor({ timeout: 20000 });

    const taxName = page.getByRole('textbox', { name: /e\.g\., TAX, Service Tax|Tax Name/i })
      .or(page.getByPlaceholder(/TAX, Service Tax|Tax Name/i))
      .first();
    const taxCode = page.getByRole('textbox', { name: /e\.g\., TAX-001|Tax Code/i })
      .or(page.getByPlaceholder(/TAX-001|Tax Code/i))
      .first();
    const taxPct = page.getByRole('spinbutton', { name: /e\.g\., 5\.00|Tax Percentage/i })
      .or(page.getByPlaceholder(/5\.00|Tax Percentage/i))
      .or(page.locator('input[type="number"]').first())
      .first();

    await taxName.waitFor({ state: 'visible', timeout: 15000 });
    await taxName.fill('');
    await taxName.fill('GST (18%)');
    await taxCode.fill('');
    await taxCode.fill('GST-18');
    await taxPct.fill('');
    await taxPct.fill('18');

    await page.getByRole('button', { name: /Create Tax/i }).first().click();
    await page.getByRole('heading', { name: /^Taxes$/i }).waitFor({ timeout: 30000 }).catch(() => undefined);
    await page.getByText(/GST \(18%\)|GST-18|18\.00%/i).first().waitFor({ timeout: 15000 }).catch(() => undefined);
    console.log('Tax settings saved: GST (18%) / GST-18 / 18%');
  }

  // Property module → Properties (next step creates property)
  await clickTopNavModule(page, 'Property');
  await page.getByRole('button', { name: /^Properties$/i })
    .or(page.getByRole('link', { name: /^Properties$/i }))
    .first()
    .click();
  await page.getByRole('heading', { name: 'Properties' }).waitFor({ timeout: 30000 });
}

/** Admin → Approval Workflows → create Deal Approve workflow (CRM / deals). */
async function configureDealApprovalWorkflow(page: import('@playwright/test').Page) {
  await dismissEndToEndFlowTour(page);
  await dismissNotificationsModal(page);

  try {
    await clickTopNavModule(page, 'Admin');
  } catch {
    await clickTopNavModule(page, 'Settings').catch(() => undefined);
  }
  await dismissEndToEndFlowTour(page);
  await dismissNotificationsModal(page);

  // Wait until Admin sidebar is visible (not still on Property)
  const adminSidebarReady = page.getByRole('button', { name: /^Employees$/i })
    .or(page.getByRole('button', { name: /^Integrations$/i }))
    .or(page.getByRole('button', { name: /Approval Workflow/i }))
    .or(page.getByText(/^Admin$/i))
    .first();
  if (!(await adminSidebarReady.isVisible({ timeout: 10000 }).catch(() => false))) {
    await page.goto('https://test.propexcel.com/admin/approval-workflows', { waitUntil: 'domcontentloaded' });
  }

  const approvalNav = page.getByRole('button', { name: /Approval Workflow/i })
    .or(page.getByRole('link', { name: /Approval Workflow/i }))
    .or(page.locator('[data-testid="sidebar-item"]').filter({ hasText: /Approval Workflow/i }))
    .or(page.getByText(/Approval Workflow/i))
    .first();

  if (await approvalNav.isVisible({ timeout: 8000 }).catch(() => false)
    || await approvalNav.count().then((c) => c > 0).catch(() => false)) {
    await approvalNav.waitFor({ state: 'attached', timeout: 15000 });
    await approvalNav.click({ force: true }).catch(async () => {
      await approvalNav.evaluate((el) => (el as HTMLElement).click());
    });
  } else {
    await page.goto('https://test.propexcel.com/admin/approval-workflows', { waitUntil: 'domcontentloaded' });
  }

  await page.getByRole('heading', { name: /Approval Workflows/i }).waitFor({ timeout: 30000 });

  // Prior run may already have Deal Approve — skip recreate
  const existingDealApprove = page.getByText(/Deal Approve/i).first();
  if (await existingDealApprove.isVisible({ timeout: 8000 }).catch(() => false)) {
    console.log('Deal Approve workflow already exists — skipping create');
    return;
  }

  await page.getByRole('button', { name: /\+?\s*Create New Workflow/i }).click();
  await page.getByText(/Loading workflow configuration/i)
    .waitFor({ state: 'hidden', timeout: 60000 })
    .catch(() => undefined);
  await page.getByRole('heading', { name: /Edit Workflow Configuration|Workflow Configuration/i })
    .first()
    .waitFor({ timeout: 30000 });

  // Visual toolbar "+ Create Step" (do not switch to Form)
  const visualTab = page.getByRole('button', { name: /^Visual$/i });
  if (await visualTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await visualTab.click();
  }
  const createStep = page.getByRole('button', { name: /\+?\s*Create Step/i }).first();
  await createStep.waitFor({ state: 'visible', timeout: 15000 });
  await createStep.click({ force: true });

  const stepDialog = page.getByRole('dialog').filter({ hasText: /Add New Step/i });
  await stepDialog.waitFor({ state: 'visible', timeout: 15000 });

  const stepName = stepDialog.getByLabel(/Step Name/i)
    .or(stepDialog.getByRole('textbox', { name: /Step Name/i }))
    .first();
  await stepName.fill('');
  await stepName.fill('Internal Approval');

  const approverType = stepDialog.getByRole('combobox', { name: /Approver Type/i })
    .or(stepDialog.getByText(/Approver Type/i).locator('xpath=following::*[@role="combobox"][1]'))
    .first();
  await approverType.click();
  await page.getByRole('option', { name: /User \(Employee\)/i }).click();

  const employeeCombo = stepDialog.getByRole('combobox', { name: /Employee|Role/i })
    .or(stepDialog.getByText(/^(Employee|Role)/i).locator('xpath=following::*[@role="combobox"][1]'))
    .first();
  await employeeCombo.click();

  // Custom Employee/Roles dropdown (search + radio) — select "Super Admin"
  const roleSearch = page.getByPlaceholder(/Search/i).last();
  if (await roleSearch.isVisible({ timeout: 2000 }).catch(() => false)) {
    await roleSearch.fill('Super Admin');
  }
  const superAdmin = page.getByText('Super Admin', { exact: true }).last();
  await superAdmin.waitFor({ state: 'visible', timeout: 15000 });
  await superAdmin.click();
  // Close employee list by focusing Step Name — Escape would close the whole dialog
  await stepName.click({ force: true }).catch(() => undefined);
  await page.waitForTimeout(300);

  const addStepBtn = stepDialog.getByRole('button', { name: /^Add Step$/i }).first();
  await addStepBtn.waitFor({ state: 'visible', timeout: 10000 });
  await addStepBtn.click({ force: true });
  await stepDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => undefined);
  await page.getByText(/Add New Step/i).first().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => undefined);

  // Workflow Configuration: Module CRM, Feature deals, name Deal Approve, Enabled
  const moduleCombo = page.getByRole('combobox', { name: /Select a module|Module/i })
    .or(page.getByText(/^Module/i).locator('xpath=following::*[@role="combobox"][1]'))
    .first();
  await moduleCombo.scrollIntoViewIfNeeded();
  await moduleCombo.click();
  await page.getByRole('option', { name: /^CRM$/i }).click();

  const featureCombo = page.getByRole('combobox', { name: /Feature|Select module first/i })
    .or(page.getByText(/^Feature/i).locator('xpath=following::*[@role="combobox"][1]'))
    .first();
  await featureCombo.click();
  await page.getByRole('option', { name: /deals/i }).first().click();

  const workflowName = page.getByLabel(/Workflow Name/i)
    .or(page.getByRole('textbox', { name: /Workflow Name/i }))
    .first();
  await workflowName.fill('');
  await workflowName.fill('Deal Approve');

  const enabled = page.getByRole('checkbox', { name: /Workflow Enabled/i })
    .or(page.getByRole('radio', { name: /Workflow Enabled/i }))
    .or(page.getByText(/Workflow Enabled/i));
  await enabled.first().click();

  // Prefer the Workflow Configuration form Save (not the canvas toolbar Save)
  await page.getByRole('button', { name: /Save Changes/i }).last().click();
  await page.getByText(/saved|success|updated|created/i).first().waitFor({ timeout: 15000 }).catch(() => undefined);
  console.log('Deal Approve workflow saved (CRM / deals)');
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

  await approveDealBtn.waitFor({ state: 'visible', timeout: 15000 });
  await approveDealBtn.click();
  console.log('Clicked Approve Deal');
  const confirmDialog = page.getByRole('dialog');
  if (await confirmDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
    await confirmDialog.getByRole('button', { name: /Approve|Confirm|Yes|Submit/i }).click();
    await confirmDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => undefined);
  }
}

async function fillInvoiceLineItemWithRentalIncome(
  page: import('@playwright/test').Page,
  amount: string,
) {
  const lineItemDialog = page.getByRole('dialog').filter({ hasText: /Line Item/i }).last();
  await lineItemDialog.getByRole('heading', { name: /Line Item/i }).waitFor({ timeout: 15000 });

  const itemField = lineItemDialog.getByLabel(/^Item$/i);
  if (await itemField.isVisible({ timeout: 2000 }).catch(() => false)) {
    await itemField.fill('rent');
  }

  // Chart of Account — open combobox (default is often 1000 - Cash)
  const chartLabel = lineItemDialog.getByText(/^Chart of Account$/i);
  const chartCombo = lineItemDialog.getByRole('combobox').filter({
    hasText: /1000 - Cash|4000 - Rental Income|Chart of Account/i,
  }).first();

  if (await chartCombo.isVisible({ timeout: 3000 }).catch(() => false)) {
    await chartCombo.click();
  } else if (await chartLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
    await chartLabel.locator('xpath=following::*[@role="combobox"][1]').click();
  } else {
    await lineItemDialog.getByText(/1000 - Cash \(Asset/i).click();
  }

  const accountSearch = lineItemDialog.getByRole('textbox', { name: /Search/i }).last();
  await accountSearch.waitFor({ state: 'visible', timeout: 10000 });
  await accountSearch.fill('4000');

  const rentalIncome = lineItemDialog.getByRole('option', { name: /4000\s*-\s*Rental Income/i })
    .or(lineItemDialog.getByText(/4000\s*-\s*Rental Income.*Operating Revenue/i))
    .or(page.getByRole('option', { name: /4000\s*-\s*Rental Income/i }))
    .or(page.getByText(/4000\s*-\s*Rental Income.*Operating Revenue/i));

  await rentalIncome.first().waitFor({ state: 'visible', timeout: 10000 });
  await rentalIncome.first().click();
  console.log('Chart of Account -> 4000 - Rental Income');

  const amountField = lineItemDialog.getByLabel(/Amount.*Incl.*Tax/i)
    .or(lineItemDialog.getByPlaceholder('0.00'))
    .or(lineItemDialog.locator('div.grid input').first());
  await amountField.first().fill(amount);

  await lineItemDialog.getByRole('button', { name: /^Save$/i }).click();
  await lineItemDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => undefined);
}

test('Flow 1 with New Organization — tenant onboarding and rent collection', async ({ page, context }) => {
  const data = generateTestData();
  const moveInDate = formatMoveInDate();
  const passwordCapture = createTenantPasswordCapture(page);
  let yopmailCredentialsPromise: ReturnType<typeof startYopmailCredentialPolling> | undefined;
  let tenantPassword: string | undefined;
  const admin = loadSharedOrgData();
  console.log('Run data:', data, 'Move-in date:', moveInDate);
  console.log('New org admin login:', { orgId: admin.orgId, email: admin.email, orgName: admin.orgName });

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
          await page.getByRole('heading', { name: 'Properties' }).waitFor({ timeout: 60000 });
      }
      {
          await configureRazorpayIntegration(page);
      }
      {
          await configureTaxSettings(page);
      }
      {
          // Admin → Approval Workflows → Deal Approve (before Create Property)
          await configureDealApprovalWorkflow(page);
          await clickTopNavModule(page, 'Property');
          await page.getByRole('button', { name: /^Properties$/i })
            .or(page.getByRole('link', { name: /^Properties$/i }))
            .first()
            .click();
          await page.getByRole('heading', { name: 'Properties' }).waitFor({ timeout: 30000 });
      }
      {

          await page.getByRole('button', { name: '+ Create Property' }).click();
          try {
            await page.waitForURL(/\/property\/properties\/create/, { timeout: 10000 });
          } catch {
            await page.getByRole('button', { name: '+ Create Property' }).click();
            await page.waitForURL(/\/property\/properties\/create/);
          }
          await page.getByRole('heading', { name: 'Create New Property' }).waitFor();
      }
      {

          await page.getByRole('button', { name: /Office \/ Building/ }).click();
      }
      {

          await page.locator("div:nth-of-type(1) > div:nth-of-type(1) > input").click();
          await page.locator("div:nth-of-type(1) > div:nth-of-type(1) > input").fill(data.propertyName);
      }
      {

          await selectRandomFromCombobox(page, 'Select category');
      }
      {

          await selectRandomFromCombobox(page, 'Select property group');
      }
      {

          //await page.locator("div.lg\\:grid-cols-4 input").click();
      }
      {

         // await page.locator("div.lg\\:grid-cols-4 input").fill('3000');
         // await page.locator("div.lg\\:grid-cols-4 input").fill('3000');
          await page.locator("div.lg\\:grid-cols-4 input[type='number']").fill('3000');


      }
      {

          await page.locator("div:nth-of-type(3) > div:nth-of-type(2) > div > div > div").click();
      }
      {

          await page.getByRole('textbox', { name: 'Rental price for Monthly' }).click();
      }
      {

          await page.getByRole('textbox', { name: 'Rental price for Monthly' }).fill('10000');
      }
      {

          await selectRandomFromCombobox(page, 'Select Tax');
      }
      {

          await page.getByRole('button', { name: 'Got it' }).click({ timeout: 5000 }).catch(() => {});
          await page.goto('https://test.propexcel.com/crm/contacts', { waitUntil: 'domcontentloaded' });
          await page.getByRole('heading', { name: 'Contacts Management' }).waitFor();
          await page.getByRole('button', { name: 'Create Contact' }).click();
          await page.getByRole('dialog', { name: 'Create New Contact' }).waitFor();
          await page.getByRole('textbox', { name: 'Enter full name' }).fill(data.fullName);
          await page.getByRole('textbox', { name: 'name@example.com' }).fill(data.email);
          await page.getByRole('textbox', { name: 'Enter mobile number' }).fill(data.mobile);
          await page.getByRole('combobox', { name: 'Enter nationality' }).click();
          await page.getByRole('textbox', { name: 'Search...' }).fill('indian');
          await page.getByRole('option', { name: 'Indian' }).click();
          const createDialog = page.getByRole('dialog', { name: 'Create New Contact' });
          await page.getByRole('button', { name: 'Create Contact' }).click();
          await createDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(async () => {
            if (await createDialog.isVisible()) {
              await createDialog.getByRole('button', { name: 'Close' }).click();
            }
          });
          await page.locator('h3').filter({ hasText: new RegExp(`^${data.fullName}$`, 'i') }).first().waitFor({ timeout: 15000 });
      }
      {

          await page.locator('h3').filter({ hasText: new RegExp(`^${data.fullName}$`, 'i') }).first().click();
          await page.getByRole('button', { name: 'Create Lead' }).click();

          const leadDialog = page.getByRole('dialog').filter({ hasText: 'Create New Lead' });
          const leadForm = await leadDialog.isVisible({ timeout: 10000 }).catch(() => false)
            ? leadDialog
            : page.getByRole('heading', { name: 'Create New Lead' }).locator('xpath=ancestor::main[1]');

          await leadForm.waitFor({ state: 'visible', timeout: 15000 });

          const scrollArea = leadForm.locator('div.overflow-y-auto, div[class*="overflow-y"]').last();
          if (await scrollArea.count()) {
            await scrollArea.evaluate((el) => { el.scrollTop = el.scrollHeight; });
          } else {
            await leadForm.evaluate((el) => { el.scrollTop = el.scrollHeight; });
          }

          const submitLeadBtn = leadForm.getByRole('button', { name: 'Create', exact: true }).last();
          await submitLeadBtn.scrollIntoViewIfNeeded();
          await expect(submitLeadBtn).toBeVisible();
          await expect(submitLeadBtn).toBeEnabled();
          await submitLeadBtn.click();
          try {
            await page.waitForURL(/\/crm\/leads\/(?!create)[^/]+$/, { timeout: 20000 });
          } catch {
            await leadForm.press('End');
            await submitLeadBtn.click({ force: true });
            await page.waitForURL(/\/crm\/leads\/(?!create)[^/]+$/, { timeout: 45000 });
          }
          await page.getByRole('button', { name: 'Convert to Deal' }).waitFor({ timeout: 30000 });
      }
      {

          await page.getByRole('button', { name: 'Convert to Deal' }).click();
          const convertDialog = page.getByRole('dialog', { name: /Convert Lead to Deal/i });
          await convertDialog.getByRole('combobox', { name: 'Select payment type...' }).click();
          await page.getByRole('option').first().click();
          await convertDialog.getByRole('button', { name: 'Convert to Deal' }).click();
          await convertDialog.waitFor({ state: 'hidden', timeout: 30000 });
          if (!page.url().includes('/crm/deals/')) {
            await page.goto('https://test.propexcel.com/crm/deals', { waitUntil: 'domcontentloaded' });
            await page.locator('h4').filter({ hasText: new RegExp(`^${data.fullName}$`, 'i') }).first().click();
          }
          await page.getByRole('heading', { name: 'Deal Details', level: 1 }).waitFor({ timeout: 30000 });
      }
      {

          await page.getByRole('button', { name: 'Add Property' }).click();
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
      }
      {

          const propertyCard = page.locator('h4', { hasText: data.propertyName }).locator('xpath=ancestor::div[contains(@class,"rounded-2xl")]').first();
          const taxCombobox = propertyCard.getByRole('combobox');
          if (await taxCombobox.isVisible({ timeout: 3000 }).catch(() => false)) {
            const taxLabel = await taxCombobox.textContent();
            if (!taxLabel || taxLabel.includes('No selection')) {
              await taxCombobox.click();
              const gstOption = page.getByRole('option', { name: /GST.*18/i }).first()
                .or(page.getByRole('option', { name: 'GST (18%) (18.00%)' }));
              await gstOption.waitFor({ state: 'visible', timeout: 10000 });
              await gstOption.click();
              await propertyCard.getByRole('button', { name: 'Save' }).click();
            }
          }
      }
      {

          await approveDealViaApprovalWorkflow(page);
      }
      {

          let viewContractBtn = page.getByRole('button', { name: 'View Contract' });          if (!await viewContractBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
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

          await page.getByRole('button', { name: 'Approve Contract' }).click();
          const approveContractDialog = page.getByRole('dialog');
          if (await approveContractDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
            await approveContractDialog.getByRole('button', { name: /Approve|Confirm|Yes|Submit/i }).click();
          }
          await page.waitForURL(/\/accounts\/contracts\//, { timeout: 30000 }).catch(async () => {
            await page.getByRole('button', { name: 'View Contract' }).click();
            await page.waitForURL(/\/accounts\/contracts\//, { timeout: 30000 });
          });
      }
      {

          await page.getByRole('tab', { name: 'Action Buttons' }).click();
          await page.getByRole('button', { name: /Create Tenant User/i }).click();
          const tenantDialog = page.getByRole('dialog');
          if (await tenantDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
            await tenantDialog.getByRole('button', { name: /Create|Confirm|Yes|Submit/i }).click();
            const dialogPassword = await captureTenantPasswordFromDialog(page);
            if (dialogPassword) {
              passwordCapture.setPassword(dialogPassword);
              console.log('Tenant password captured from dialog');
            }
            await tenantDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
          }
          if (!passwordCapture.getPassword()) {
            yopmailCredentialsPromise = startYopmailCredentialPolling(context, data.email, page);
          }
      }
      {

          await page.getByRole('tab', { name: 'Action Buttons' }).click();
          await page.getByRole('button', { name: /Create Move In Request/i }).click();
          const moveInDialog = page.getByRole('dialog', { name: /Create Move-In Date/i });
          await moveInDialog.waitFor({ state: 'visible', timeout: 10000 });
          const dateField = moveInDialog.getByLabel('Tenant Move-in Date');
          await dateField.click();
          await dateField.fill(moveInDate);
          await moveInDialog.getByRole('button', { name: 'Confirm' }).click();
          await moveInDialog.waitFor({ state: 'hidden', timeout: 15000 });
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
            yopmailPromise: yopmailCredentialsPromise,
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
              console.log('Login failed — retrying with fresh YOPmail fetch');
              const retryCredentials = await getTenantCredentialsFromYopmail(page, data.email);
              tenantPassword = retryCredentials.password;
              const passwordField = page.getByRole('textbox', { name: /^Password$/i }).or(page.locator('#password'));
              await passwordField.first().fill('');
              await passwordField.first().fill(retryCredentials.password!);
              await page.getByRole('button', { name: 'Sign In' }).click();
            }
          } else if (tenantCredentials.loginLink?.includes('test.propexcel.com')) {
            await page.goto(tenantCredentials.loginLink, { waitUntil: 'domcontentloaded' });
          } else {
            throw new Error(`No tenant password available for ${data.email}`);
          }

          await page.waitForURL(
            (url) => url.hostname.includes('test.propexcel.com') && !url.pathname.includes('/login'),
            { timeout: 60000 },
          );
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
          await page.getByPlaceholder('Search...').fill(data.fullName);

          const tenantOption = page.getByText(new RegExp(`${data.fullName}.*\\(Tenant\\)`, 'i')).first();
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
          if (!tenantPassword) {
            const refreshed = await resolveTenantCredentials({
              capturedPassword: passwordCapture.getPassword(),
              yopmailPromise: yopmailCredentialsPromise,
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
    throw new Error('Cannot save shared tenant data — password is missing.');
  }

  saveSharedTenantDataNewOrg({
    fullName: data.fullName,
    email: data.email,
    mobile: data.mobile,
    propertyName: data.propertyName,
    password: tenantPassword,
    orgId: admin.orgId,
    moveInDate,
  });

  passwordCapture.dispose();
});
