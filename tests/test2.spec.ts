import { test, expect, Page, Locator } from '@playwright/test';
import { loadSharedTenantData } from '../utils/SharedTenantData';
import { nextSharedCategory, SHARED_CATEGORIES } from '../utils/SharedCategory';

function randomSuffix() {
  return Date.now().toString().slice(-6);
}

function randomGst() {
  return `29AAAAA${Math.floor(1000 + Math.random() * 9000)}A1Z5`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fillLoginForm(
  page: Page,
  orgId: string,
  email: string,
  password: string,
) {
  await page.goto('https://test.propexcel.com/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: /Welcome Back/i }).waitFor({ timeout: 30000 });

  const org = page.getByRole('textbox', { name: /Organization ID/i })
    .or(page.locator('#tenantId'));
  const emailField = page.getByRole('textbox', { name: /Email Address/i })
    .or(page.locator('#email'));
  const passwordField = page.getByRole('textbox', { name: /^Password$/i })
    .or(page.locator('#password'));

  await org.first().fill(orgId);
  await emailField.first().fill(email);
  await passwordField.first().fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
}

function dropdownOptionLocator(page: Page) {
  return page.locator(
    [
      '[role="listbox"] [role="option"]',
      '[role="option"]',
      '[data-radix-select-item]',
      '[data-slot="select-item"]',
      '[cmdk-item]',
      '[role="listbox"] [data-value]',
      '[data-radix-popper-content-wrapper] [role="option"]',
      '[data-radix-popper-content-wrapper] div[data-value]',
    ].join(', '),
  );
}

async function openCombobox(page: Page, combo: Locator) {
  await combo.waitFor({ state: 'visible', timeout: 10000 });
  await combo.scrollIntoViewIfNeeded();

  // Avoid the inner "Clear selection" button by clicking left side of the control
  const box = await combo.boundingBox();
  if (box) {
    await page.mouse.click(box.x + Math.min(40, box.width / 4), box.y + box.height / 2);
  } else {
    await combo.click({ force: true });
  }

  const options = dropdownOptionLocator(page);
  const opened = await options.first().waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
  if (opened) return;

  // Keyboard fallback (Radix / custom selects)
  await combo.focus().catch(() => undefined);
  await page.keyboard.press('ArrowDown');
  await options.first().waitFor({ state: 'visible', timeout: 5000 }).catch(async () => {
    await page.keyboard.press('Enter');
    await options.first().waitFor({ state: 'visible', timeout: 5000 });
  });
}

async function pickFromOpenedList(
  page: Page,
  label: string,
  preferred?: string | RegExp,
): Promise<string> {
  const options = dropdownOptionLocator(page);
  await options.first().waitFor({ state: 'visible', timeout: 10000 });
  const count = await options.count();
  if (count === 0) {
    throw new Error(`No options found for ${label}`);
  }

  const allTexts: string[] = [];
  for (let i = 0; i < count; i++) {
    allTexts.push(((await options.nth(i).textContent()) || '').trim());
  }

  if (preferred) {
    const matcher = preferred instanceof RegExp ? preferred : new RegExp(`^${escapeRegExp(preferred)}$`, 'i');
    for (let i = 0; i < count; i++) {
      const text = allTexts[i];
      if (matcher.test(text)) {
        console.log(`${label} -> ${text}`);
        await options.nth(i).click();
        return text;
      }
    }
    throw new Error(
      `${label}: preferred "${preferred}" not found. Available: ${allTexts.filter(Boolean).join(', ')}`,
    );
  }

  const candidates: number[] = [];
  for (let i = 0; i < count; i++) {
    const text = allTexts[i];
    if (text && !/not selected|^-+$/i.test(text)) {
      candidates.push(i);
    }
  }
  const pool = candidates.length > 0 ? candidates : [...Array(count).keys()];
  const index = pool[Math.floor(Math.random() * pool.length)];
  const option = options.nth(index);
  const selected = allTexts[index];
  console.log(`${label} -> [${index + 1}/${count}] ${selected}`);
  await option.click();
  return selected;
}

async function fieldCombobox(page: Page, fieldLabel: string) {
  // Label text sits next to the combobox in the same parent block
  const labeled = page.getByRole('combobox', { name: new RegExp(`^${fieldLabel}$`, 'i') });
  if (await labeled.first().isVisible({ timeout: 1500 }).catch(() => false)) {
    return labeled.first();
  }

  return page
    .getByText(new RegExp(`^${fieldLabel}\\s*\\*?$`, 'i'))
    .locator('xpath=following::*[(@role="combobox") or self::select][1]');
}

async function selectFormDropdown(
  page: Page,
  labelText: string,
  fieldName: string,
  preferred?: string,
): Promise<string> {
  const combo = await fieldCombobox(page, labelText);
  await openCombobox(page, combo);
  return pickFromOpenedList(page, fieldName, preferred);
}

async function selectProperty(page: Page, propertyName: string): Promise<string> {
  const combo = page.getByRole('combobox', { name: /^Property$/i }).first();
  await openCombobox(page, combo);
  return pickFromOpenedList(page, 'Property', propertyName || undefined);
}

async function selectVendorCategory(page: Page, category: string): Promise<string> {
  // Category combobox has no aria-label — match by known / shared category text
  const known = [...SHARED_CATEGORIES, 'Cleaning', 'IT Services', 'Marketing', 'Select'].join('|');
  const categoryCombo = page.getByRole('combobox').filter({
    hasText: new RegExp(known, 'i'),
  }).first();
  await openCombobox(page, categoryCombo);
  return pickFromOpenedList(page, 'Vendor Category', category);
}

/**
 * Flow 2 — uses tenant created by Flow 1 (tests/test1.spec.ts).
 * Request category and Vendor category use the same rotating shared value.
 * Run together:
 *   npx playwright test tests/test1.spec.ts tests/test2.spec.ts --headed
 */
test('Propexcel Flow 2 — tenant request then create vendor', async ({ page }) => {
  const tenant = loadSharedTenantData();
  const suffix = randomSuffix();
  const requestTitle = `Request ${suffix}`;
  const sharedCategory = nextSharedCategory();
  const vendor = {
    name: `Vendor ${suffix}`,
    contactName: `Contact ${suffix}`,
    email: `vendor${suffix}@yopmail.com`,
    mobile: `9${Math.floor(100000000 + Math.random() * 900000000)}`,
    gst: randomGst(),
    city: 'Hyderabad',
    state: 'Telangana',
    country: 'India',
    address: `${suffix} Test Street, Hyderabad`,
  };

  console.log('Flow 2 using shared tenant:', {
    fullName: tenant.fullName,
    email: tenant.email,
    propertyName: tenant.propertyName,
    orgId: tenant.orgId,
    savedAt: tenant.savedAt,
  });
  console.log('Flow 2 shared category:', sharedCategory);
  console.log('Flow 2 vendor data:', vendor);

  test.setTimeout(300_000);
  page.setDefaultTimeout(30_000);

  // 1) Login as tenant from Flow 1
  await fillLoginForm(page, tenant.orgId, tenant.email, tenant.password);
  await page.waitForURL(
    (url) => url.hostname.includes('test.propexcel.com') && !url.pathname.includes('/login'),
    { timeout: 60000 },
  );

  // 2) Tenant Requests → Create Request
  await page.goto('https://test.propexcel.com/tenant/requests', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: /^Requests$/i }).waitFor({ timeout: 15000 });

  await page.getByRole('button', { name: /Create Request/i }).click();
  await page.getByRole('heading', { name: /New Request/i }).waitFor({ timeout: 15000 });

  const selectedProperty = await selectProperty(page, tenant.propertyName);

  const titleInput = page.getByLabel(/Title/i).first();
  if (await titleInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await titleInput.fill(requestTitle);
  } else {
    await page.locator('input[value="New Request"], input[name*="title" i]').first().fill(requestTitle);
  }

  const selectedCategory = await selectFormDropdown(page, 'Category', 'Category', sharedCategory);
  const selectedPriority = await selectFormDropdown(page, 'Priority', 'Priority');

  const requestDescription =
    `Automated ${selectedCategory} request for property ${selectedProperty}. ` +
    `Priority: ${selectedPriority}. Please review and process. Ref: ${suffix}`;

  const description = page.getByPlaceholder(/Provide detailed description/i);
  if (await description.isVisible({ timeout: 2000 }).catch(() => false)) {
    await description.fill(requestDescription);
  } else {
    await page.getByLabel(/Description/i).fill(requestDescription);
  }

  await page.getByRole('button', { name: /Submit Request/i }).click();

  // Back on requests board / list — confirm title is visible
  await expect(page.getByText(new RegExp(requestTitle, 'i')).first()).toBeVisible({ timeout: 30000 });
  console.log('Tenant request submitted:', {
    title: requestTitle,
    property: selectedProperty,
    category: selectedCategory,
    priority: selectedPriority,
  });

  // 3) Logout tenant
  const tenantProfile = page.getByRole('button', { name: new RegExp(tenant.fullName, 'i') });
  if (await tenantProfile.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    await tenantProfile.first().click();
  } else {
    await page.locator('header').getByRole('button').last().click();
  }
  await page.getByText('Logout', { exact: true }).click();
  await page.waitForURL(/\/login/, { timeout: 15000 });

  // 4) Login Super Admin
  await fillLoginForm(page, tenant.orgId || 'test240', 'test240@yopmail.com', 'Test2026$');
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60000 });

  // 5) Accounts → Vendors
  await page.goto('https://test.propexcel.com/accounts/vendors', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: /Vendors/i }).waitFor({ timeout: 15000 });

  // 6) Create Vendor (same shared category as request)
  await page.getByRole('button', { name: /Create Vendor/i }).click();
  await page.getByRole('heading', { name: /Create Vendor/i }).waitFor({ timeout: 15000 });

  // Vendor Details
  await page.getByPlaceholder(/ABC Supplies/i).fill(vendor.name);
  const vendorCategory = await selectVendorCategory(page, sharedCategory);
  await page.getByPlaceholder(/Registration number/i).fill(vendor.gst);

  // Contact Information
  await page.getByPlaceholder(/Primary contact person/i).fill(vendor.contactName);
  await page.getByPlaceholder(/vendor@example.com/i).fill(vendor.email);
  await page.getByPlaceholder(/Contact number/i).fill(vendor.mobile);

  // Location & Address
  await page.getByPlaceholder('City', { exact: true }).fill(vendor.city);
  await page.getByPlaceholder('State', { exact: true }).fill(vendor.state);
  await page.getByPlaceholder('Country', { exact: true }).fill(vendor.country);
  await page.getByPlaceholder(/Full address/i).fill(vendor.address);

  // 7) Submit vendor
  await page.getByRole('button', { name: /^Create Vendor$/i }).click();

  // Confirm vendor appears
  await expect(page.getByText(new RegExp(vendor.name, 'i')).first()).toBeVisible({ timeout: 30000 });
  console.log('Vendor created successfully:', {
    name: vendor.name,
    category: vendorCategory,
    matchedRequestCategory: selectedCategory === vendorCategory,
  });
});
