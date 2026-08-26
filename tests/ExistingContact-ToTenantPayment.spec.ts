/**
 * Existing Contact → Tenant Payment
 * Login (org.json) → Admin Approval Workflow (Deal Approve) → CRM existing contact → lead/deal → tenant → rent pay.
 * Super Admin login comes from Create Organization (test-data/org.json).
 *
 * Run:
 *   npx playwright test tests/CreateOrganization.spec.ts tests/ExistingContact-ToTenantPayment.spec.ts --headed
 */
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
import { loadSharedCrmData } from "../utils/SharedCrmData";

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
  await btn.waitFor({ state: 'attached', timeout: 15000 });
  await btn.evaluate((el) => (el as HTMLElement).click());
}

/** Ensure GST (5%) exists under Accounts → Taxes so deal tax dropdown can select it. */
async function ensureGst5PercentTax(page: import('@playwright/test').Page) {
  await dismissEndToEndFlowTour(page);
  await dismissNotificationsModal(page);

  await page.goto('https://test.propexcel.com/accounts/taxes', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: /^Taxes$/i }).waitFor({ timeout: 30000 });

  const gst5Row = page.getByRole('row').filter({ hasText: /GST\s*\(\s*5\s*%\s*\)/i }).first();
  if (await gst5Row.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('GST (5%) tax already exists — skipping create');
    return;
  }

  await page.getByRole('button', { name: /\+?\s*Create New Tax/i }).first().click();
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

  await taxName.fill('GST (5%)');
  await taxCode.fill('GST-05');
  await taxPct.fill('5');
  await page.getByRole('button', { name: /Create Tax/i }).first().click();
  await page.getByText(/GST\s*\(\s*5\s*%\s*\)|GST-05/i).first().waitFor({ timeout: 15000 }).catch(() => undefined);
  console.log('Tax settings saved: GST (5%) / GST-05 / 5%');
}

/**
 * Deal property card: if rent is 0, set random rent (120000–600000), discount (10–30%),
 * select tax, Save → Mark as site visit → Submit for Approval.
 */
async function fillDealPropertyPricingAndSubmit(page: import('@playwright/test').Page, propertyName: string) {
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
  if (rentValue === 0) {
    const rent = Math.floor(120000 + Math.random() * (600000 - 120000 + 1));
    await rentInput.click();
    await rentInput.fill('');
    await rentInput.fill(String(rent));
    console.log('Set property rent:', rent);
  } else {
    console.log('Property rent already set:', rentValue);
  }

  // DISCOUNT (%) — 10 to 30
  const discount = Math.floor(10 + Math.random() * (30 - 10 + 1));
  const discountInput = propertyCard.getByRole('spinbutton', { name: /DISCOUNT\s*\(%\)|Discount\s*\(%\)/i })
    .or(propertyCard.getByLabel(/DISCOUNT\s*\(%\)|Discount\s*\(%\)/i))
    .or(propertyCard.locator('input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]').nth(1))
    .first();
  if (await discountInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await discountInput.click();
    await discountInput.fill('');
    await discountInput.fill(String(discount));
    console.log('Set discount %:', discount);
  }

  // TAX % dropdown — always select GST (5%)
  const taxCombobox = propertyCard.getByRole('combobox').first();
  if (await taxCombobox.isVisible({ timeout: 5000 }).catch(() => false)) {
    const taxLabel = ((await taxCombobox.textContent()) || '').trim();
    if (!taxLabel || /No selection/i.test(taxLabel) || !/GST\s*\(\s*5\s*%\s*\)/i.test(taxLabel)) {
      await taxCombobox.click();
      const taxOption = page.getByRole('option', { name: /GST\s*\(\s*5\s*%\s*\)/i }).first();
      await taxOption.waitFor({ state: 'visible', timeout: 10000 });
      await taxOption.click();
      console.log('Selected deal property tax: GST (5%)');
    }
  }

  await propertyCard.getByRole('button', { name: /^Save$/i }).click();
  await page.getByText(/saved|success|updated/i).first().waitFor({ timeout: 10000 }).catch(() => undefined);
  console.log('Deal property pricing saved');

  const siteVisitBtn = page.getByRole('button', { name: /Mark as site visit/i }).first();
  await siteVisitBtn.waitFor({ state: 'visible', timeout: 15000 });
  await siteVisitBtn.click();
  console.log('Clicked Mark as site visit');
  const siteVisitDialog = page.getByRole('dialog');
  if (await siteVisitDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
    await siteVisitDialog.getByRole('button', { name: /Confirm|Yes|Submit|Save|OK/i }).click().catch(() => undefined);
    await siteVisitDialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => undefined);
  }

  const submitForApproval = page.getByRole('button', { name: /Submit for Approval/i }).first();
  await submitForApproval.waitFor({ state: 'visible', timeout: 15000 });
  await submitForApproval.click();
  console.log('Clicked Submit for Approval');
  const submitDialog = page.getByRole('dialog');
  if (await submitDialog.isVisible({ timeout: 4000 }).catch(() => false)) {
    await submitDialog.getByRole('button', { name: /Submit|Approve|Confirm|Yes/i }).click();
    await submitDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => undefined);
  }
}

/**
 * After Submit for Approval: scroll to Approval Workflow → Internal Approval → Approve.
 * Matches PropExcel deal page when Deal Approve workflow is enabled.
 */
async function approveDealViaApprovalWorkflow(page: import('@playwright/test').Page) {
  // Prefer "Submit for Approval" (workflow-enabled UI); fall back to legacy "Approve Deal"
  // Skip if already submitted from fillDealPropertyPricingAndSubmit
  const submitForApproval = page.getByRole('button', { name: /Submit for Approval/i }).first();
  const approveDealBtn = page.getByRole('button', { name: /^Approve Deal$/i }).first();
  const approveBtnEarly = page.getByRole('button', { name: /^Approve$/i }).first();

  if (await approveBtnEarly.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('Approve already available — skipping Submit for Approval');
  } else if (await submitForApproval.isVisible({ timeout: 5000 }).catch(() => false)) {
    await submitForApproval.click();
    console.log('Clicked Submit for Approval');
  } else if (await approveDealBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await approveDealBtn.click();
    console.log('Clicked Approve Deal');
  }

  // Optional confirm dialog (Submit / Approve / Confirm)
  const confirmDialog = page.getByRole('dialog');
  if (await confirmDialog.isVisible({ timeout: 4000 }).catch(() => false)) {
    await confirmDialog.getByRole('button', { name: /Submit|Approve|Confirm|Yes/i }).click();
    await confirmDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => undefined);
  }

  await page.getByText(/Deal property submitted successfully|Approval In Progress|submitted successfully/i)
    .first()
    .waitFor({ state: 'visible', timeout: 20000 })
    .catch(() => undefined);

  // Approval Workflow panel → Internal Approval → Approve
  const workflowSection = page.getByText(/Approval Workflow/i).first();
  await workflowSection.waitFor({ state: 'visible', timeout: 30000 });
  await workflowSection.scrollIntoViewIfNeeded();

  // Wait for workflow to finish loading / leave Preview-NOT INITIATED if possible
  await page.getByText(/Loading workflow/i).waitFor({ state: 'hidden', timeout: 30000 }).catch(() => undefined);
  await page.getByText(/IN PROGRESS|Your Action Required/i).first()
    .waitFor({ state: 'visible', timeout: 30000 })
    .catch(() => undefined);

  // If still "Submit for Approval", click again after tax/property save
  const submitAgain = page.getByRole('button', { name: /Submit for Approval/i }).first();
  if (await submitAgain.isVisible({ timeout: 2000 }).catch(() => false)) {
    await submitAgain.click();
    console.log('Re-clicked Submit for Approval');
    await page.waitForTimeout(1500);
  }

  const approveBtn = page.getByRole('button', { name: /^Approve$/i }).first();
  await approveBtn.waitFor({ state: 'visible', timeout: 30000 });
  await approveBtn.scrollIntoViewIfNeeded();
  await approveBtn.click();
  console.log('Clicked Approve on Internal Approval step');

  const confirmApprove = page.getByRole('button', { name: /^Confirm$/i }).first();
  if (await confirmApprove.isVisible({ timeout: 8000 }).catch(() => false)) {
    await confirmApprove.click();
    console.log('Clicked Confirm on approval step');
  }

  // Wait until workflow shows APPROVED / COMPLETED
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

test('Existing Contact to Tenant Payment — onboard contact through rent payment (new org)', async ({ page, context }) => {
  const data = generateTestData();
  const moveInDate = formatMoveInDate();
  const passwordCapture = createTenantPasswordCapture(page);
  let yopmailCredentialsPromise: ReturnType<typeof startYopmailCredentialPolling> | undefined;
  let tenantPassword: string | undefined;
  const admin = loadSharedOrgData();
  const crm = loadSharedCrmData();
  if (!crm.contacts.length) {
    throw new Error('No contacts in SharedCrmData — run Creating Contacts,Leads,Deals.spec.ts first.');
  }
  const sharedContact = crm.contacts[Math.floor(Math.random() * crm.contacts.length)];
  data.fullName = sharedContact.fullName;
  data.email = sharedContact.email;
  data.mobile = sharedContact.mobile;
  console.log('Run data (from SharedCrmData contact):', data, 'Move-in date:', moveInDate);
  console.log('Existing Contact→Payment admin login (from CreateOrganization org.json):', {
    orgId: admin.orgId,
    email: admin.email,
    orgName: admin.orgName,
  });
  console.log('Picked shared CRM contact:', sharedContact);

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
          // Deal Approve workflow is configured in Flow1-NewOrganization (after tax) — skip here
          // Ensure GST (5%) exists for deal property tax dropdown
          await ensureGst5PercentTax(page);
      }
      {
          // CRM → Contacts → open contact from SharedCrmData
          try {
            await clickTopNavModule(page, 'CRM');
            await page.getByRole('button', { name: /^Contacts$/i })
              .or(page.getByRole('link', { name: /^Contacts$/i }))
              .first()
              .click({ timeout: 10000 });
          } catch {
            await page.goto('https://test.propexcel.com/crm/contacts', { waitUntil: 'domcontentloaded' });
          }
          await page.getByRole('heading', { name: 'Contacts Management' }).waitFor({ timeout: 30000 });

          const contactHeading = page.locator('h3')
            .filter({ hasText: new RegExp(`^${sharedContact.fullName}$`, 'i') })
            .first();
          await contactHeading.waitFor({ state: 'visible', timeout: 30000 });
          console.log('Opening shared contact:', sharedContact.fullName);
          await contactHeading.click();
      }
      {
          // Create Lead from contact (Flow1 pattern). Only if duplicate exists, open deals/leads by contact.
          const openExistingLeadOrDealForContact = async () => {
            console.log('Lead already exists for contact — opening existing lead/deal:', sharedContact.fullName);
            const escapedName = sharedContact.fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const nameRe = new RegExp(escapedName, 'i');

            // Prefer Deals (lead may already be converted)
            await page.goto('https://test.propexcel.com/crm/deals', { waitUntil: 'domcontentloaded' });
            const dealSearch = page.getByPlaceholder(/Search/i).first()
              .or(page.getByRole('combobox', { name: /Search/i }).first());
            if (await dealSearch.isVisible({ timeout: 5000 }).catch(() => false)) {
              await dealSearch.fill(sharedContact.fullName);
              await page.waitForTimeout(1000);
            }
            const dealCard = page.locator('h3, h4, a').filter({ hasText: nameRe }).first();
            if (await dealCard.isVisible({ timeout: 10000 }).catch(() => false)) {
              await dealCard.click();
              await page.getByRole('heading', { name: 'Deal Details', level: 1 }).waitFor({ timeout: 30000 });
              return;
            }

            // Else Leads list (clear My Leads + use List view)
            await page.goto('https://test.propexcel.com/crm/leads', { waitUntil: 'domcontentloaded' });
            const myLeads = page.getByRole('button', { name: /^My Leads$/i });
            if (await myLeads.isVisible({ timeout: 3000 }).catch(() => false)) {
              await myLeads.click();
              const allLeadsOpt = page.getByRole('option', { name: /All Leads/i })
                .or(page.getByText(/^All Leads$/i));
              if (await allLeadsOpt.first().isVisible({ timeout: 3000 }).catch(() => false)) {
                await allLeadsOpt.first().click();
              } else {
                await page.keyboard.press('Escape');
              }
            }
            const listView = page.getByRole('button', { name: /^List$/i });
            if (await listView.isVisible({ timeout: 3000 }).catch(() => false)) {
              await listView.click();
            }
            const leadSearch = page.getByRole('combobox', { name: /Search by Leads/i })
              .or(page.getByPlaceholder(/Search/i).first());
            if (await leadSearch.isVisible({ timeout: 5000 }).catch(() => false)) {
              await leadSearch.fill(sharedContact.email);
              await page.waitForTimeout(1000);
            }
            const leadCard = page.locator('h3, h4, a, td').filter({ hasText: nameRe }).first()
              .or(page.locator('h3, h4, a, td').filter({ hasText: new RegExp(sharedContact.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first());
            await leadCard.waitFor({ state: 'visible', timeout: 30000 });
            await leadCard.click();
            await page.waitForURL(/\/crm\/(leads|deals)\/(?!create)/, { timeout: 30000 });
          };

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

          const duplicateLead = page.getByText(/lead with this email and phone number already exists/i);
          try {
            await page.waitForURL(/\/crm\/leads\/(?!create)/, { timeout: 20000 });
          } catch {
            if (await duplicateLead.isVisible({ timeout: 2000 }).catch(() => false)) {
              await openExistingLeadOrDealForContact();
            } else {
              await leadForm.press('End').catch(() => undefined);
              await submitLeadBtn.click({ force: true });
              try {
                await page.waitForURL(/\/crm\/leads\/(?!create)/, { timeout: 45000 });
              } catch {
                if (await duplicateLead.isVisible({ timeout: 3000 }).catch(() => false)) {
                  await openExistingLeadOrDealForContact();
                } else {
                  throw new Error('Create Lead failed — did not navigate to lead details and no duplicate message shown');
                }
              }
            }
          }

          if (!page.url().includes('/crm/deals/')) {
            await page.getByRole('button', { name: 'Convert to Deal' }).waitFor({ timeout: 30000 });
          }
      }
      {

          const convertBtn = page.getByRole('button', { name: 'Convert to Deal' });
          const alreadyOnDeal = page.url().includes('/crm/deals/')
            || await page.getByRole('heading', { name: 'Deal Details', level: 1 })
              .isVisible({ timeout: 2000 })
              .catch(() => false);

          if (alreadyOnDeal) {
            console.log('Already on deal details — skipping Convert to Deal');
          } else if (await convertBtn.isVisible({ timeout: 15000 }).catch(() => false)) {
            await convertBtn.click();
            const convertDialog = page.getByRole('dialog', { name: /Convert Lead to Deal/i });
            await convertDialog.getByRole('combobox', { name: 'Select payment type...' }).click();
            await page.getByRole('option').first().click();
            await convertDialog.getByRole('button', { name: 'Convert to Deal' }).click();
            await convertDialog.waitFor({ state: 'hidden', timeout: 30000 });
          } else {
            // Lead already converted — open deal from lead or deals list
            const viewDeal = page.getByRole('button', { name: /View Deal|Open Deal/i })
              .or(page.getByRole('link', { name: /View Deal|Open Deal/i }));
            if (await viewDeal.first().isVisible({ timeout: 5000 }).catch(() => false)) {
              await viewDeal.first().click();
            } else {
              await page.goto('https://test.propexcel.com/crm/deals', { waitUntil: 'domcontentloaded' });
              await page.locator('h4')
                .filter({ hasText: new RegExp(`^${data.fullName}$`, 'i') })
                .first()
                .click();
            }
          }

          if (!page.url().includes('/crm/deals/')) {
            await page.goto('https://test.propexcel.com/crm/deals', { waitUntil: 'domcontentloaded' });
            await page.locator('h4')
              .filter({ hasText: new RegExp(`^${data.fullName}$`, 'i') })
              .first()
              .click();
          }
          await page.getByRole('heading', { name: 'Deal Details', level: 1 }).waitFor({ timeout: 30000 });
      }
      {

          // Prefer property already on the deal (prior run) — Add Property stays disabled otherwise
          const propertyOnDeal = page.locator('div.rounded-2xl').filter({ hasText: /PROPERTY RENT|Property Rent/i }).first();
          if (await propertyOnDeal.isVisible({ timeout: 5000 }).catch(() => false)) {
            const nameEl = propertyOnDeal.locator('h4').first();
            data.propertyName = ((await nameEl.textContent()) || '').trim() || data.propertyName;
            console.log('Deal already has property:', data.propertyName);
          } else {
            const addPropertyBtn = page.getByRole('button', { name: 'Add Property' }).or(page.getByRole('button', { name: /\+?\s*Add Property/i })).first();
            await addPropertyBtn.waitFor({ state: 'visible', timeout: 15000 });
            await addPropertyBtn.click();
            const addPropertyDialog = page.getByRole('dialog', { name: /Add Property to Deal/i });
            const existingProperty = addPropertyDialog.locator('h3').first();
            await existingProperty.waitFor({ state: 'visible', timeout: 15000 });
            data.propertyName = ((await existingProperty.textContent()) || '').trim() || data.propertyName;
            console.log('Selected existing property for deal:', data.propertyName);
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
