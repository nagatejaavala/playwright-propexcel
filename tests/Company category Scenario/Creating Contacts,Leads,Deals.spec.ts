/**
 * Company category — seed CRM contacts/leads as Company contact type.
 * Saves: test-data/crm-contacts-leads-company.json
 */
import { test, expect } from '../../utils/test';
import { loadSharedOrgData } from '../../utils/SharedOrgData';
import { saveSharedCrmDataCompany } from '../../utils/SharedCrmData';
import {
  commitSequentialTenantIdentity,
  fillIndiaPhoneInContactDialog,
  fillIndiaPhoneInLeadForm,
  peekNextSequentialTenantIdentity,
} from '../../utils/SharedTenantContactData';
import { selectCompanyContactTypeAndFill } from '../../utils/CompanyContact';

type PersonData = {
  fullName: string;
  companyName?: string;
  email: string;
  mobile: string;
  tenantNumber: number;
};

function peekTenantPerson(): PersonData {
  const tenant = peekNextSequentialTenantIdentity();
  return {
    fullName: tenant.fullName,
    email: tenant.email,
    mobile: tenant.mobile,
    tenantNumber: tenant.number,
  };
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

async function dismissEndToEndFlowTour(page: import('@playwright/test').Page) {
  const popover = page.locator('#driver-popover-content, .driver-popover, [role="dialog"].flow-popover').first();
  const title = page.getByText(/PropExcel End-to-End Flow/i).first();
  const iframeTour = page.locator('iframe[src*="propexcel-end-to-end-flow"]').first();

  const visible =
    (await title.isVisible({ timeout: 8000 }).catch(() => false)) ||
    (await popover.isVisible({ timeout: 1000 }).catch(() => false)) ||
    (await iframeTour.isVisible({ timeout: 1000 }).catch(() => false));
  if (!visible) return;

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  const closeBtn = page.locator(
    '#driver-popover-content button, .driver-popover button, [role="dialog"].flow-popover button',
  ).filter({ hasText: /close|skip|done|×|x/i })
    .or(page.locator('.driver-popover-close-btn, button[aria-label*="Close" i]'))
    .first();

  if (await closeBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await closeBtn.click({ force: true });
  }

  if (
    (await popover.isVisible({ timeout: 500 }).catch(() => false)) ||
    (await iframeTour.isVisible({ timeout: 500 }).catch(() => false)) ||
    (await title.isVisible({ timeout: 500 }).catch(() => false))
  ) {
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

async function goToCrmContacts(page: import('@playwright/test').Page) {
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
  await dismissEndToEndFlowTour(page);
  await dismissNotificationsModal(page);
}

async function goToCrmLeads(page: import('@playwright/test').Page) {
  const leadsNav = page.getByRole('button', { name: /^Leads$/i })
    .or(page.getByRole('link', { name: /^Leads$/i }))
    .first();
  if (await leadsNav.isVisible({ timeout: 5000 }).catch(() => false)) {
    await leadsNav.click();
  } else {
    await clickTopNavModule(page, 'CRM');
    await page.getByRole('button', { name: /^Leads$/i })
      .or(page.getByRole('link', { name: /^Leads$/i }))
      .first()
      .click({ timeout: 10000 })
      .catch(async () => {
        await page.goto('https://test.propexcel.com/crm/leads', { waitUntil: 'domcontentloaded' });
      });
  }
  await page.waitForURL(/\/crm\/leads/, { timeout: 30000 }).catch(() => undefined);
  await page.getByRole('heading', { name: /Leads/i }).first().waitFor({ timeout: 30000 }).catch(() => undefined);
}

/** Create Contact — Company type + sequential tenantN + India (+91) mobile. */
async function createContact(page: import('@playwright/test').Page, data: PersonData) {
  await dismissEndToEndFlowTour(page);
  await page.getByRole('button', { name: 'Create Contact' }).click();
  const createDialog = page.getByRole('dialog', { name: 'Create New Contact' });
  await createDialog.waitFor();
  const company = await selectCompanyContactTypeAndFill(createDialog);
  data.companyName = company.companyName;
  await createDialog.getByRole('textbox', { name: 'Enter full name' }).fill(data.fullName);
  await createDialog.getByRole('textbox', { name: 'name@example.com' }).fill(data.email);
  await fillIndiaPhoneInContactDialog(createDialog, data.mobile);
  await createDialog.getByRole('combobox', { name: 'Enter nationality' }).click();
  await createDialog.getByRole('textbox', { name: 'Search...' }).fill('indian');
  await page.getByRole('option', { name: 'Indian', exact: true }).click();
  await createDialog.getByRole('button', { name: 'Create Contact' }).click();
  await createDialog.waitFor({ state: 'hidden', timeout: 30000 });
  await page.getByRole('combobox', { name: /Search by Contacts/i }).fill(data.fullName);
  await page.locator('h3').filter({ hasText: new RegExp(`^${data.fullName}$`, 'i') }).first().waitFor({ timeout: 30000 });
  commitSequentialTenantIdentity(data.tenantNumber);
  console.log('Company contact created:', data.fullName, data.companyName, data.email, data.mobile);
}

/**
 * Create Lead from Leads page (NOT from a contact):
 * Create Lead → search → Create New Lead → Company type + details → Convert to Deal.
 */
async function createLeadStandalone(page: import('@playwright/test').Page, data: PersonData) {
  await goToCrmLeads(page);

  // 1) Open Create Lead modal
  const createLeadBtn = page.getByRole('button', { name: /Create Lead|\+ Create Lead/i }).first();
  await createLeadBtn.waitFor({ state: 'visible', timeout: 15000 });
  await createLeadBtn.click();

  const searchDialog = page.getByRole('dialog').filter({ hasText: /Create New Lead/i });
  await searchDialog.waitFor({ state: 'visible', timeout: 15000 });

  // 2) Enter random value in "Search by Name, Email or Phone..."
  const searchBox = searchDialog
    .getByPlaceholder(/Search by Name, Email or Phone/i)
    .or(searchDialog.getByRole('textbox', { name: /Search by Name, Email or Phone/i }))
    .first();
  await searchBox.waitFor({ state: 'visible', timeout: 10000 });
  await searchBox.fill(data.fullName);
  console.log('Lead search typed:', data.fullName);

  // 3) Wait for "No matches found" then click dropdown row "Create New Lead" / Start with '…'
  await searchDialog.getByText(/No matches found/i).waitFor({ state: 'visible', timeout: 15000 });
  const createNewLeadOption = searchDialog.locator('div.cursor-pointer')
    .filter({ hasText: /Create New Lead/i })
    .filter({ hasText: /Start with/i });
  await createNewLeadOption.waitFor({ state: 'visible', timeout: 10000 });
  await createNewLeadOption.click();
  console.log('Clicked Create New Lead option for search:', data.fullName);

  // Wait until search picker advances to the lead form
  await searchDialog.getByText(/No matches found/i).waitFor({ state: 'hidden', timeout: 15000 }).catch(() => undefined);

  // 4) Full Create New Lead form — Company type + details
  const leadForm = page.getByRole('dialog').filter({ hasText: /Create New Lead/i });
  await leadForm.waitFor({ state: 'visible', timeout: 15000 });

  const company = await selectCompanyContactTypeAndFill(leadForm);
  data.companyName = company.companyName;

  // Name * — placeholder "Full name"
  const nameField = leadForm.getByRole('textbox', { name: 'Full name' })
    .or(leadForm.getByPlaceholder('Full name'))
    .first();
  await nameField.waitFor({ state: 'visible', timeout: 20000 });
  await nameField.fill(data.fullName);

  // Email
  const emailField = leadForm.getByRole('textbox', { name: 'name@example.com' })
    .or(leadForm.getByPlaceholder('name@example.com'))
    .first();
  await emailField.fill(data.email);

  // Mobile — India +91
  await fillIndiaPhoneInLeadForm(leadForm, data.mobile);

  // Nationality — placeholder "e.g., UAE"
  const nationality = leadForm.getByRole('combobox', { name: /e\.g\., UAE|nationality/i }).first();
  if (await nationality.isVisible({ timeout: 3000 }).catch(() => false)) {
    await nationality.click();
    const search = page.getByRole('textbox', { name: 'Search...' });
    if (await search.isVisible({ timeout: 2000 }).catch(() => false)) {
      await search.fill('indian');
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

  const submitLeadBtn = leadForm.getByRole('button', { name: /^Create$/i }).last();
  await submitLeadBtn.scrollIntoViewIfNeeded();
  await expect(submitLeadBtn).toBeVisible();
  await expect(submitLeadBtn).toBeEnabled();
  await submitLeadBtn.click();

  try {
    await page.waitForURL(/\/crm\/leads\/(?!create)[^/]+$/, { timeout: 20000 });
  } catch {
    await leadForm.press('End').catch(() => undefined);
    await submitLeadBtn.click({ force: true });
    await page.waitForURL(/\/crm\/leads\/(?!create)[^/]+$/, { timeout: 45000 });
  }

  // Lead Details page → click Convert to Deal
  const convertBtn = page.getByRole('button', { name: 'Convert to Deal' });
  await convertBtn.waitFor({ state: 'visible', timeout: 30000 });
  await convertBtn.click();

  // Convert Lead to Deal modal → random Payment Type → Convert to Deal
  const convertDialog = page.getByRole('dialog', { name: /Convert Lead to Deal/i });
  await convertDialog.waitFor({ state: 'visible', timeout: 15000 });
  const paymentCombo = convertDialog.getByRole('combobox', { name: /payment type|Select payment type/i })
    .or(convertDialog.getByText(/Select payment type/i));
  await paymentCombo.first().click();
  const paymentOptions = page.getByRole('option');
  await paymentOptions.first().waitFor({ state: 'visible', timeout: 10000 });
  const paymentCount = await paymentOptions.count();
  const paymentIndex = Math.floor(Math.random() * paymentCount);
  const paymentLabel = ((await paymentOptions.nth(paymentIndex).textContent()) || '').trim();
  await paymentOptions.nth(paymentIndex).click();
  console.log(`Payment Type -> [${paymentIndex + 1}/${paymentCount}] ${paymentLabel}`);
  await convertDialog.getByRole('button', { name: 'Convert to Deal' }).click();
  await convertDialog.waitFor({ state: 'hidden', timeout: 30000 });
  commitSequentialTenantIdentity(data.tenantNumber);
  console.log('Converted company lead to deal:', data.fullName, data.companyName, data.email, data.mobile);
}

test('Company Category — Creating Contacts and Leads (4 each, sequential tenantN)', async ({ page, context }) => {
  const admin = loadSharedOrgData();
  const contacts: PersonData[] = [];
  const leads: PersonData[] = [];

  console.log('Admin login (from CreateOrganization org.json):', {
    orgId: admin.orgId,
    email: admin.email,
    orgName: admin.orgName,
  });
  console.log('Contacts to create: (peeked one at a time during run)');
  console.log('Leads to create: (peeked one at a time during run)');

  test.setTimeout(400_000);
  page.setDefaultTimeout(30_000);
  await context.grantPermissions(['geolocation'], { origin: 'https://test.propexcel.com' });

  // Login with CreateOrganization shared data
  {
    await page.goto('https://test.propexcel.com/login', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /Welcome Back/i }).waitFor({ timeout: 30000 });
    await fillLoginFields(page, admin.orgId, admin.email, admin.password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60000 });
    await dismissEndToEndFlowTour(page);
    await dismissNotificationsModal(page);
  }

  // Phase 1: CRM → Contacts → create 4 contacts (tenantN sequential)
  {
    await goToCrmContacts(page);
    for (let i = 0; i < 4; i++) {
      const person = peekTenantPerson();
      await createContact(page, person);
      contacts.push(person);
    }
  }

  // Phase 2: Left sidebar → Leads → create 4 leads (next tenantN sequence)
  {
    for (let i = 0; i < 4; i++) {
      const person = peekTenantPerson();
      await createLeadStandalone(page, person);
      leads.push(person);
    }
  }

  // Persist contacts + leads for existing-scenario reuse
  {
    saveSharedCrmDataCompany({
      orgId: admin.orgId,
      orgName: admin.orgName,
      contacts: contacts.map(({ fullName, companyName, email, mobile }) => ({
        fullName,
        companyName,
        email,
        mobile,
      })),
      leads: leads.map(({ fullName, companyName, email, mobile }) => ({
        fullName,
        companyName,
        email,
        mobile,
      })),
    });
  }
});
