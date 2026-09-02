import { test, expect } from '../utils/test';
import type { Page, Locator, BrowserContext } from '@playwright/test';
import { loadSharedTenantDataNewOrg } from '../utils/SharedTenantData';
import { nextSharedCategory, SHARED_CATEGORIES } from '../utils/SharedCategory';
import { loadSharedOrgData } from '../utils/SharedOrgData';
import { FlowPerfTracker, saveFlowPerformance } from '../utils/FlowPerformance';

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

/** Dismiss new-org onboarding tour modal (PropExcel End-to-End Flow) if it appears after login. */
async function dismissEndToEndFlowTour(page: Page) {
  const title = page.getByText('PropExcel End-to-End Flow', { exact: true }).first();
  const visible = await title.isVisible({ timeout: 10000 }).catch(() => false);
  if (!visible) return;

  const dialog = page.getByRole('dialog').filter({ hasText: /PropExcel End-to-End Flow/i }).first();
  const root = (await dialog.isVisible().catch(() => false))
    ? dialog
    : title.locator('xpath=ancestor::div[.//text()[contains(.,"1 of")] or .//button][1]');

  const closeBtn = root
    .getByRole('button', { name: /close|cancel/i })
    .or(root.locator('button[aria-label*="Close" i], button[aria-label*="close" i], button[aria-label*="Cancel" i]'))
    .or(root.locator('button').filter({ hasText: /^[×x✕]$/i }))
    .or(title.locator('xpath=ancestor::div[1]//button[not(contains(.,"Previous")) and not(contains(.,"Next"))]').last())
    .first();

  if (await closeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await closeBtn.click();
  } else {
    await page.keyboard.press('Escape');
  }

  await title.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => undefined);
  console.log('Dismissed PropExcel End-to-End Flow tour');
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

async function closeOpenDropdowns(page: Page) {
  const propertySearch = page.getByPlaceholder(/Search properties/i);
  if (await propertySearch.isVisible({ timeout: 500 }).catch(() => false)) {
    await page.getByRole('heading', { name: /New Request/i }).click({ force: true });
    await propertySearch.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
  }

  const expanded = page.getByRole('combobox', { expanded: true });
  for (let i = 0; i < 3; i++) {
    if (!(await expanded.first().isVisible({ timeout: 500 }).catch(() => false))) {
      return;
    }
    await page.getByRole('heading', { name: /New Request/i }).click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(200);
    if (!(await expanded.first().isVisible({ timeout: 500 }).catch(() => false))) {
      return;
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  await expanded.first().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => undefined);
}

async function openCombobox(page: Page, combo: Locator) {
  await combo.waitFor({ state: 'visible', timeout: 10000 });
  await combo.scrollIntoViewIfNeeded();
  await closeOpenDropdowns(page);

  const options = dropdownOptionLocator(page);
  const propertySearch = page.getByPlaceholder(/Search properties/i);
  const box = await combo.boundingBox();
  if (box) {
    await page.mouse.click(box.x + Math.min(40, box.width / 4), box.y + box.height / 2);
  } else {
    await combo.click({ force: true });
  }

  if (await options.first().isVisible({ timeout: 3000 }).catch(() => false)
    || await propertySearch.isVisible({ timeout: 1000 }).catch(() => false)) {
    return;
  }

  await combo.click({ force: true }).catch(() => undefined);
  if (await options.first().isVisible({ timeout: 3000 }).catch(() => false)
    || await propertySearch.isVisible({ timeout: 1000 }).catch(() => false)) {
    return;
  }

  // Keyboard fallback (Radix / custom selects)
  await combo.focus().catch(() => undefined);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  if (await options.first().isVisible({ timeout: 3000 }).catch(() => false)
    || await propertySearch.isVisible({ timeout: 1000 }).catch(() => false)) {
    return;
  }
  await page.keyboard.press('Space');
  await Promise.race([
    options.first().waitFor({ state: 'visible', timeout: 10000 }),
    propertySearch.waitFor({ state: 'visible', timeout: 10000 }),
  ]);
}

async function pickFromOpenedList(
  page: Page,
  label: string,
  preferred?: string | RegExp,
  fallbackPreferred?: string | RegExp,
): Promise<string> {
  const options = dropdownOptionLocator(page);
  await options.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(400);
  let count = await options.count();
  if (count === 0) {
    // Some property pickers render clickable rows without role=option.
    const alt = page.locator(
      '[data-radix-popper-content-wrapper] [cursor="pointer"], [data-radix-popper-content-wrapper] .cursor-pointer, [role="listbox"] > div, [cmdk-list] [cmdk-item]',
    );
    if (await alt.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      const altCount = await alt.count();
      const texts: string[] = [];
      for (let i = 0; i < altCount; i++) {
        texts.push(((await alt.nth(i).textContent()) || '').trim());
      }
      const matchers: RegExp[] = [];
      for (const pref of [preferred, fallbackPreferred]) {
        if (!pref) continue;
        matchers.push(pref instanceof RegExp ? pref : new RegExp(escapeRegExp(pref), 'i'));
      }
      for (const matcher of matchers) {
        for (let i = 0; i < altCount; i++) {
          if (matcher.test(texts[i])) {
            console.log(`${label} -> ${texts[i]}`);
            await alt.nth(i).click();
            await closeOpenDropdowns(page);
            return texts[i];
          }
        }
      }
      const idx = texts.findIndex((t) => t && !/not selected|^-+$|search/i.test(t));
      if (idx >= 0) {
        console.log(`${label} -> [${idx + 1}/${altCount}] ${texts[idx]}`);
        await alt.nth(idx).click();
        await closeOpenDropdowns(page);
        return texts[idx];
      }
    }
    throw new Error(`No options found for ${label}`);
  }

  const allTexts: string[] = [];
  for (let i = 0; i < count; i++) {
    allTexts.push(((await options.nth(i).textContent()) || '').trim());
  }

  const matchers: RegExp[] = [];
  for (const pref of [preferred, fallbackPreferred]) {
    if (!pref) continue;
    matchers.push(pref instanceof RegExp ? pref : new RegExp(`^${escapeRegExp(pref)}$`, 'i'));
  }
  // Also allow substring match for preferred property labels like "auto25 1006"
  if (preferred && typeof preferred === 'string') {
    matchers.push(new RegExp(escapeRegExp(preferred), 'i'));
  }

  if (matchers.length > 0) {
    for (const matcher of matchers) {
      for (let i = 0; i < count; i++) {
        const text = allTexts[i];
        if (matcher.test(text)) {
          console.log(`${label} -> ${text}`);
          await options.nth(i).click();
          await closeOpenDropdowns(page);
          return text;
        }
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
  await closeOpenDropdowns(page);
  return selected;
}

async function comboboxForLabel(scope: Page | Locator, label: string): Promise<Locator> {
  const labelPattern = new RegExp(`^${escapeRegExp(label)}\\s*\\*?$`, 'i');
  const byRole = scope.getByRole('combobox', { name: new RegExp(`^${label}`, 'i') });
  if (await byRole.first().isVisible({ timeout: 1500 }).catch(() => false)) {
    return byRole.first();
  }

  const labelEl = scope.getByText(labelPattern, { exact: true }).first();
  for (const ancestor of ['xpath=..', 'xpath=../..']) {
    const inField = labelEl.locator(ancestor).getByRole('combobox').first();
    if (await inField.isVisible({ timeout: 1500 }).catch(() => false)) {
      return inField;
    }
  }

  return labelEl.locator('xpath=following::*[@role="combobox"][1]');
}

async function taskDialogCombobox(taskDialog: Locator, label: string): Promise<Locator> {
  // Prefer "Status *" / "Priority *" (form) over plain "Status" in Request Details
  const requiredPattern = new RegExp(`^${escapeRegExp(label)}\\s*\\*$`, 'i');
  const plainPattern = new RegExp(`^${escapeRegExp(label)}$`, 'i');

  for (const pattern of [requiredPattern, plainPattern]) {
    const labels = taskDialog.getByText(pattern);
    const count = await labels.count();
    for (let i = count - 1; i >= 0; i--) {
      const labelEl = labels.nth(i);
      if (!(await labelEl.isVisible({ timeout: 500 }).catch(() => false))) continue;
      for (const ancestor of ['xpath=..', 'xpath=../..', 'xpath=../../..']) {
        const combo = labelEl.locator(ancestor).getByRole('combobox').first();
        if (await combo.isVisible({ timeout: 800 }).catch(() => false)) {
          return combo;
        }
      }
    }
  }

  if (/^status$/i.test(label)) {
    const byValue = taskDialog.getByRole('combobox').filter({ hasText: /^(Open|Done|In Progress)$/i }).first();
    if (await byValue.isVisible({ timeout: 2000 }).catch(() => false)) return byValue;
  }
  if (/^priority$/i.test(label)) {
    const byValue = taskDialog.getByRole('combobox').filter({ hasText: /^(Low|Medium|High)$/i }).first();
    if (await byValue.isVisible({ timeout: 2000 }).catch(() => false)) return byValue;
  }
  if (/assign to vendor/i.test(label)) {
    const byValue = taskDialog.getByRole('combobox').filter({ hasText: /Not Assigned/i }).last();
    if (await byValue.isVisible({ timeout: 2000 }).catch(() => false)) return byValue;
  }

  throw new Error(`Combobox not found for ${label} in Add Task dialog`);
}

async function selectFormDropdown(
  page: Page,
  labelText: string,
  fieldName: string,
  preferred?: string,
  scope?: Locator,
): Promise<string> {
  const root = scope ?? page;
  const combo = await comboboxForLabel(root, labelText);
  await combo.waitFor({ state: 'visible', timeout: 15000 });
  const current = ((await combo.textContent()) || '').trim();
  if (preferred) {
    const matcher = new RegExp(`^${escapeRegExp(preferred)}$`, 'i');
    if (matcher.test(current)) {
      console.log(`${fieldName} already set -> ${current}`);
      return current;
    }
  } else if (current && !/^(-{2,}|not selected|select)/i.test(current)) {
    console.log(`${fieldName} already set -> ${current}`);
    return current;
  }
  await openCombobox(page, combo);
  return pickFromOpenedList(page, fieldName, preferred);
}

async function resolveTaskCombobox(
  taskDialog: Locator,
  comboHint: RegExp,
  fieldName: string,
  index: number,
): Promise<Locator> {
  const labels = [
    fieldName,
    fieldName.replace(/^Task /, ''),
    fieldName.replace(/^Assign to /, ''),
    'Assigned To',
    'Assign to',
    'Vendor',
    'Status',
    'Priority',
  ];

  for (const label of labels) {
    const byLabel = await comboboxForLabel(taskDialog, label);
    if (await byLabel.isVisible({ timeout: 1500 }).catch(() => false)) {
      return byLabel;
    }
  }

  for (const label of labels) {
    const byRole = taskDialog.getByRole('combobox', { name: new RegExp(label, 'i') });
    if (await byRole.first().isVisible({ timeout: 1500 }).catch(() => false)) {
      return byRole.first();
    }
  }

  const all = taskDialog.getByRole('combobox');
  const count = await all.count();
  for (let i = 0; i < count; i++) {
    const combo = all.nth(i);
    const text = ((await combo.textContent()) || '').trim();
    if (comboHint.test(text)) {
      return combo;
    }
  }

  if (!/assign to (vendor|employee)/i.test(fieldName)) {
    const filtered = taskDialog.getByRole('combobox').filter({ hasText: comboHint });
    if (await filtered.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      return filtered.first();
    }
  }

  if (index < count) {
    return all.nth(index);
  }
  if (count > 0) {
    return all.last();
  }
  throw new Error(`Combobox not found for ${fieldName}`);
}

async function closeTaskDropdownOnly(page: Page, taskDialog: Locator) {
  const heading = taskDialog.getByRole('heading', { name: /Add Task/i });
  if (await heading.isVisible({ timeout: 1000 }).catch(() => false)) {
    await heading.click({ force: true });
    return;
  }
  await page.keyboard.press('Escape').catch(() => undefined);
}

async function selectTaskDialogFieldByLabel(
  page: Page,
  taskDialog: Locator,
  label: string,
  fieldName: string,
  preferred?: string | RegExp,
): Promise<string> {
  const combo = await taskDialogCombobox(taskDialog, label);
  await combo.waitFor({ state: 'visible', timeout: 15000 });
  const current = ((await combo.textContent()) || '').trim();
  if (preferred) {
    const matcher = preferred instanceof RegExp
      ? preferred
      : new RegExp(`^${escapeRegExp(preferred)}$`, 'i');
    if (matcher.test(current)) {
      console.log(`${fieldName} already set -> ${current}`);
      return current;
    }
  } else if (current && !/^(-{2,}|not assigned|select)/i.test(current)) {
    console.log(`${fieldName} already set -> ${current}`);
    return current;
  }
  await combo.scrollIntoViewIfNeeded();
  await openCombobox(page, combo);
  return pickFromOpenedList(page, fieldName, preferred);
}

async function assignVendorInTaskDialog(
  page: Page,
  taskDialog: Locator,
  vendorName: string,
): Promise<string> {
  const vendorCombo = await taskDialogCombobox(taskDialog, 'Assign to Vendor');
  await vendorCombo.scrollIntoViewIfNeeded();

  const deadline = Date.now() + 60_000;
  let lastError: Error | undefined;
  while (Date.now() < deadline) {
    try {
      await openCombobox(page, vendorCombo);
      const search = page.getByRole('textbox', { name: /Search/i }).last();
      if (await search.isVisible({ timeout: 2000 }).catch(() => false)) {
        await search.fill('');
        await search.fill(vendorName);
        await page.waitForTimeout(1000);
      }
      return await pickFromOpenedList(
        page,
        'Assign to Vendor',
        new RegExp(escapeRegExp(vendorName), 'i'),
        /Super Admin/i,
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.log(`Assign to Vendor: retry — ${lastError.message}`);
      await closeTaskDropdownOnly(page, taskDialog);
      await page.waitForTimeout(2000);
    }
  }
  throw lastError ?? new Error('Assign to Vendor: could not select vendor');
}

async function selectTaskDialogDropdown(
  page: Page,
  taskDialog: Locator,
  comboHint: RegExp,
  fieldName: string,
  preferred?: string | RegExp,
  searchText?: string,
  comboIndex = 0,
  fallbackPreferred?: string | RegExp,
): Promise<string> {
  const deadline = Date.now() + 60_000;
  let lastError: Error | undefined;

  while (Date.now() < deadline) {
    const combo = await resolveTaskCombobox(taskDialog, comboHint, fieldName, comboIndex);
    await openCombobox(page, combo);
    if (searchText) {
      const search = page.getByRole('textbox', { name: /Search/i }).last();
      if (await search.isVisible({ timeout: 2000 }).catch(() => false)) {
        await search.fill('');
        await search.fill(searchText);
        await page.waitForTimeout(800);
      }
    }
    try {
      return await pickFromOpenedList(page, fieldName, preferred, fallbackPreferred);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (fallbackPreferred && lastError.message.includes('not found')) {
        throw lastError;
      }
      console.log(`${fieldName}: dropdown retry — ${lastError.message}`);
      await closeTaskDropdownOnly(page, taskDialog);
      await page.waitForTimeout(2000);
    }
  }

  throw lastError ?? new Error(`${fieldName}: could not select from dropdown`);
}

async function selectProperty(page: Page, propertyName: string): Promise<string> {
  const combo = page.getByRole('combobox', { name: /^Property$/i }).first()
    .or(page.getByRole('combobox').filter({ hasText: /Not Selected|Property/i }).first());
  const current = ((await combo.textContent()) || '').trim();
  if (propertyName && new RegExp(escapeRegExp(propertyName), 'i').test(current)) {
    console.log(`Property already set -> ${current}`);
    return current;
  }

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await openCombobox(page, combo);

      // Tenant property picker is often a searchable list, not plain options.
      const propertySearch = page.getByPlaceholder(/Search properties|Search/i).first()
        .or(page.getByRole('textbox', { name: /Search properties|Search/i }).first());
      if (await propertySearch.isVisible({ timeout: 3000 }).catch(() => false)) {
        const query = (propertyName || '').trim();
        await propertySearch.fill('');
        if (query) {
          await propertySearch.fill(query);
          await page.waitForTimeout(600);
        }
      } else {
        await page.waitForTimeout(800);
      }

      // Prefer exact name, then unit/token match, then any property.
      const unitToken = (propertyName.match(/\b\d{3,5}\b/) || [])[0];
      try {
        return await pickFromOpenedList(
          page,
          'Property',
          propertyName || undefined,
          unitToken ? new RegExp(escapeRegExp(unitToken), 'i') : undefined,
        );
      } catch (exactErr) {
        console.log(`Property preferred match failed (attempt ${attempt}): ${(exactErr as Error).message}`);
        // Any non-empty property option
        return await pickFromOpenedList(page, 'Property');
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.log(`Property select retry ${attempt}/3 — ${lastError.message}`);
      await closeOpenDropdowns(page);
      await page.waitForTimeout(1500);
      await combo.click({ force: true }).catch(() => undefined);
    }
  }

  throw lastError ?? new Error('No options found for Property');
}

async function logoutSuperAdmin(page: Page, profileHint?: string) {
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

async function logoutTenant(page: Page, fullName: string) {
  const tenantProfile = page.getByRole('button', { name: new RegExp(fullName, 'i') });
  if (await tenantProfile.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    await tenantProfile.first().click();
  } else {
    await page.locator('header').getByRole('button').last().click();
  }
  await page.getByText('Logout', { exact: true }).click();
  await page.waitForURL(/\/login/, { timeout: 15000 });
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

function itemNameForCategory(category: string): string {
  const map: Record<string, string[]> = {
    Maintenance: ['AC Maintenance', 'Washing Machine Maintenance', 'Plumbing Maintenance'],
    Cleaning: ['Deep Cleaning', 'Carpet Cleaning', 'Kitchen Cleaning'],
    Other: ['General Service', 'Misc Service Charge', 'Other Service Work'],
    Repair: ['AC Repair', 'Washing Machine Repair', 'Appliance Repair'],
  };
  const options = map[category] ?? [`${category} Service`];
  return options[Math.floor(Math.random() * options.length)];
}

async function selectBillCombobox(
  page: Page,
  labelText: string,
  fieldName: string,
  preferred: string | RegExp,
): Promise<string> {
  const combo = await comboboxForLabel(page, labelText);
  await openCombobox(page, combo);

  // Searchable comboboxes often have a Search textbox
  const search = page.getByRole('textbox', { name: /Search/i }).last();
  if (await search.isVisible({ timeout: 1500 }).catch(() => false)) {
    const query = preferred instanceof RegExp
      ? (preferred.source.replace(/^\^|\$$/g, '').replace(/\\/g, '') || '')
      : preferred;
    if (query) {
      await search.fill(query.slice(0, 40));
    }
  }

  return pickFromOpenedList(page, fieldName, preferred);
}

/**
 * Bill Chart of Account: search by vendor category; if no match, search "6" and pick random.
 */
async function selectChartOfAccountByVendorCategory(
  page: Page,
  root: Locator,
  category: string,
): Promise<string> {
  const chartLabel = root.getByText(/^Chart of Account$/i);
  const chartCombo = root.getByRole('combobox').filter({
    hasText: /Select Expense Account|Select account|Cash|Service Revenue|Chart of Account|4100|1000|4000|6\d{3}/i,
  }).first()
    .or(root.getByRole('combobox').first());

  if (await chartCombo.isVisible({ timeout: 3000 }).catch(() => false)) {
    await openCombobox(page, chartCombo);
  } else if (await chartLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
    await chartLabel.locator('xpath=following::*[@role="combobox"][1]').click();
  }

  const accountSearch = root.getByRole('textbox', { name: /Search/i }).last()
    .or(page.getByRole('textbox', { name: /Search/i }).last());
  await accountSearch.waitFor({ state: 'visible', timeout: 10000 });

  const catQuery = category.trim();
  await accountSearch.fill('');
  await accountSearch.fill(catQuery);
  await page.waitForTimeout(400);

  const options = dropdownOptionLocator(page);
  const catRe = new RegExp(escapeRegExp(catQuery), 'i');
  let matchedCount = 0;
  const visibleCount = await options.count();
  for (let i = 0; i < visibleCount; i++) {
    const text = ((await options.nth(i).textContent()) || '').trim();
    if (text && catRe.test(text)) {
      matchedCount++;
    }
  }

  if (matchedCount > 0) {
    for (let i = 0; i < visibleCount; i++) {
      const text = ((await options.nth(i).textContent()) || '').trim();
      if (text && catRe.test(text)) {
        await options.nth(i).click();
        console.log(`Chart of Account (by category "${catQuery}") -> ${text}`);
        return text;
      }
    }
  }

  // Fallback: search "6" → pick any random option
  await accountSearch.fill('');
  await accountSearch.fill('6');
  await page.waitForTimeout(400);
  await options.first().waitFor({ state: 'visible', timeout: 10000 });
  const fallbackCount = await options.count();
  if (fallbackCount === 0) {
    throw new Error(`Chart of Account: no options for category "${catQuery}" or fallback search "6"`);
  }
  const idx = Math.floor(Math.random() * fallbackCount);
  const picked = ((await options.nth(idx).textContent()) || '').trim();
  await options.nth(idx).click();
  console.log(`Chart of Account (fallback search "6", category was "${catQuery}") -> ${picked}`);
  return picked;
}

async function fillBillLineItem(
  page: Page,
  itemName: string,
  quantity: string,
  unitPrice: string,
  vendorCategory: string,
) {
  const lineItemDialog = page.getByRole('dialog').filter({ hasText: /Line Item/i }).last();
  await lineItemDialog.getByRole('heading', { name: /Line Item/i }).waitFor({ timeout: 15000 });

  const itemField = lineItemDialog.getByPlaceholder(/Item name/i)
    .or(lineItemDialog.getByLabel(/^Item$/i));
  await itemField.first().fill(itemName);

  // Spinbuttons expose current value as accessible name ("0" / "0.00"), not the label
  const qtyField = lineItemDialog.getByRole('spinbutton', { name: '0' })
    .or(lineItemDialog.locator('xpath=.//*[normalize-space()="Quantity *" or normalize-space()="Quantity"]/following::input[1]'));
  await qtyField.first().click();
  await qtyField.first().fill(quantity);

  const priceField = lineItemDialog.getByRole('spinbutton', { name: '0.00' })
    .or(lineItemDialog.locator('xpath=.//*[normalize-space()="Unit Price *" or normalize-space()="Unit Price"]/following::input[1]'));
  await priceField.first().click();
  await priceField.first().fill(unitPrice);

  await selectChartOfAccountByVendorCategory(page, lineItemDialog, vendorCategory);

  // Tax — pick a real tax if available, else keep / select any option
  const taxCombo = lineItemDialog.getByRole('combobox').filter({
    hasText: /Tax|No Tax|GST|VAT/i,
  }).first();
  if (await taxCombo.isVisible({ timeout: 3000 }).catch(() => false)) {
    await openCombobox(page, taxCombo);
    const options = dropdownOptionLocator(page);
    await options.first().waitFor({ state: 'visible', timeout: 5000 });
    const count = await options.count();
    let picked = false;
    for (let i = 0; i < count; i++) {
      const text = ((await options.nth(i).textContent()) || '').trim();
      if (text && !/^No Tax$/i.test(text)) {
        console.log(`Tax -> ${text}`);
        await options.nth(i).click();
        picked = true;
        break;
      }
    }
    if (!picked) {
      await pickFromOpenedList(page, 'Tax');
    }
  }

  await lineItemDialog.getByRole('button', { name: /^Save$/i }).click();
  await lineItemDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => undefined);
}

async function fillInvoiceLineItemWithRentalIncome(
  page: Page,
  itemName: string,
  amount: string,
) {
  const lineItemDialog = page.getByRole('dialog').filter({ hasText: /Line Item/i }).last();
  await lineItemDialog.getByRole('heading', { name: /Line Item/i }).waitFor({ timeout: 15000 });

  const itemField = lineItemDialog.getByLabel(/^Item$/i)
    .or(lineItemDialog.getByPlaceholder(/Item name/i));
  if (await itemField.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await itemField.first().fill(itemName);
  }

  const chartLabel = lineItemDialog.getByText(/^Chart of Account$/i);
  const chartCombo = lineItemDialog.getByRole('combobox').filter({
    hasText: /1000 - Cash|4000 - Rental Income|4100 - Service Revenue|Chart of Account/i,
  }).first();

  if (await chartCombo.isVisible({ timeout: 3000 }).catch(() => false)) {
    await chartCombo.click();
  } else if (await chartLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
    await chartLabel.locator('xpath=following::*[@role="combobox"][1]').click();
  } else {
    await lineItemDialog.getByText(/1000 - Cash \(Asset/i).click();
  }

  // Combobox search/options are portaled outside the dialog
  const accountSearch = page.getByRole('textbox', { name: /Search/i })
    .or(page.getByPlaceholder(/Search/i))
    .last();
  if (await accountSearch.isVisible({ timeout: 5000 }).catch(() => false)) {
    await accountSearch.fill('4000');
  }

  const rentalIncome = page.getByRole('option', { name: /4000\s*-\s*Rental Income/i })
    .or(page.getByRole('option', { name: /4000/i }));

  await rentalIncome.first().waitFor({ state: 'visible', timeout: 10000 });
  await rentalIncome.first().click();
  console.log('Invoice Chart of Account -> 4000');

  const amountField = lineItemDialog.getByLabel(/Amount.*Incl.*Tax/i)
    .or(lineItemDialog.getByPlaceholder('0.00'))
    .or(lineItemDialog.locator('div.grid input').first());
  await amountField.first().fill(amount);

  await lineItemDialog.getByRole('button', { name: /^Save$/i }).click();
  await lineItemDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => undefined);
}

async function payViaRazorpayNetbanking(page: Page, context: BrowserContext) {
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

  const netbankingLabel = razorpayFrame.getByText('Netbanking', { exact: true });
  await netbankingLabel.waitFor({ state: 'visible', timeout: 15000 });
  await netbankingLabel.click();

  await continuePaymentIfExitPrompt();

  const netbankingReady = razorpayFrame.getByText(/Suggested Banks|Search for Banks|Bank of Baroda/i).first();
  if (!await netbankingReady.isVisible({ timeout: 5000 }).catch(() => false)) {
    await razorpayFrame.getByRole('radio', { name: /Netbanking/i }).click();
    await continuePaymentIfExitPrompt();
  }
  await netbankingReady.waitFor({ state: 'visible', timeout: 20000 });

  const suggestedBankBtn = razorpayFrame
    .getByRole('heading', { name: 'Suggested Banks' })
    .locator('xpath=following::*[@role="button"][contains(., "Bank of Baroda")][1]');

  let bankPage: Page | null = null;
  try {
    [bankPage] = await Promise.all([
      context.waitForEvent('page', { timeout: 60000 }),
      suggestedBankBtn.evaluate((el) => (el as HTMLElement).click()),
    ]);
  } catch {
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

/**
 * Flow 2 with New Organization — uses tenant from Flow1-NewOrganization.spec.ts
 * (test-data/tenant-new-org.json) and Super Admin from org.json (CreateOrganization.spec.ts).
 *
 * Run:
 *   npx playwright test tests/CreateOrganization.spec.ts tests/Flow1-NewOrganization.spec.ts tests/Flow2-NewOrganization.spec.ts --headed
 */
test('Flow 2 with New Organization — tenant request, vendor, bill, and invoice', async ({ page, context }) => {
  const tenant = loadSharedTenantDataNewOrg();
  const admin = loadSharedOrgData();
  if (tenant.orgId && tenant.orgId !== admin.orgId) {
    throw new Error(
      `Stale tenant-new-org.json: tenant orgId "${tenant.orgId}" does not match org.json "${admin.orgId}". ` +
        'Run Flow1-NewOrganization.spec.ts first for the current org.',
    );
  }
  const suffix = randomSuffix();
  const requestTitle = `Request ${suffix}`;
  const taskTitle = `Task ${suffix}`;
  const sharedCategory = nextSharedCategory();
  const vendor = {
    name: `Vendor ${suffix}`,
    contactName: `Contact ${suffix}`,
    email: `propexceltest+vendor${suffix}@gmail.com`,
    mobile: `9${Math.floor(100000000 + Math.random() * 900000000)}`,
    gst: randomGst(),
    city: 'Hyderabad',
    state: 'Telangana',
    country: 'India',
    address: `${suffix} Test Street, Hyderabad`,
  };

  console.log('Flow 2 New Org using shared tenant:', {
    fullName: tenant.fullName,
    email: tenant.email,
    propertyName: tenant.propertyName,
    orgId: tenant.orgId,
    savedAt: tenant.savedAt,
  });
  console.log('Flow 2 New Org admin login:', { orgId: admin.orgId, email: admin.email, orgName: admin.orgName });
  console.log('Flow 2 shared category:', sharedCategory);
  console.log('Flow 2 vendor data:', vendor);

  test.setTimeout(720_000);
  page.setDefaultTimeout(30_000);
  const perf = new FlowPerfTracker();
  let selectedCategory = '';
  let selectedPriority = '';
  let vendorCategory = '';
  let refNo = '';
  let billItemName = '';
  let invoiceAmount = '';

  await perf.step('Tenant login + create request', async () => {
  // 1) Login as tenant from Flow 1 New Org (tenant-new-org.json)
  await fillLoginForm(page, tenant.orgId || admin.orgId, tenant.email, tenant.password);
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

  async function fillRequestTitle() {
    const titleInput = page.getByLabel(/Title/i).first()
      .or(page.locator('input[value="New Request"], input[name*="title" i]'))
      .or(page.getByRole('textbox', { name: /Title|New Request/i }));
    await titleInput.first().waitFor({ state: 'visible', timeout: 10000 });
    await titleInput.first().click();
    await titleInput.first().fill('');
    await titleInput.first().fill(requestTitle);
    await expect(titleInput.first()).toHaveValue(requestTitle, { timeout: 5000 }).catch(async () => {
      await titleInput.first().pressSequentially(requestTitle, { delay: 20 });
    });
  }

  await fillRequestTitle();
  await closeOpenDropdowns(page);

  selectedCategory = await selectFormDropdown(page, 'Category', 'Category', sharedCategory);
  selectedPriority = await selectFormDropdown(page, 'Priority', 'Priority');

  const requestDescription =
    `Automated ${selectedCategory} request for property ${selectedProperty}. ` +
    `Priority: ${selectedPriority}. Please review and process. Ref: ${suffix}`;

  const description = page.getByPlaceholder(/Provide detailed description/i);
  if (await description.isVisible({ timeout: 2000 }).catch(() => false)) {
    await description.fill(requestDescription);
  } else {
    await page.getByLabel(/Description/i).fill(requestDescription);
  }

  // Re-apply title in case dropdowns reset the default "New Request"
  await fillRequestTitle();

  await page.getByRole('button', { name: /Submit Request/i }).click();

  await Promise.race([
    page.getByText(new RegExp(escapeRegExp(requestTitle), 'i')).first()
      .waitFor({ state: 'visible', timeout: 30000 }),
    page.getByText(/^Submitted$/i).first().waitFor({ state: 'visible', timeout: 30000 }),
  ]);
  await expect(
    page.getByText(new RegExp(escapeRegExp(requestTitle), 'i'))
      .or(page.getByText(/^Submitted$/i))
      .first(),
  ).toBeVisible({ timeout: 5000 });
  console.log('Tenant request submitted:', {
    title: requestTitle,
    property: selectedProperty,
    category: selectedCategory,
    priority: selectedPriority,
  });

  });

  await perf.step('Admin vendor create', async () => {
  // 3) Logout tenant
  await logoutTenant(page, tenant.fullName);

  // 4) Login Super Admin (from org.json)
  await fillLoginForm(page, admin.orgId, admin.email, admin.password);
  await dismissEndToEndFlowTour(page);
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60000 });

  // 5) Accounts → Vendors
  await page.goto('https://test.propexcel.com/accounts/vendors', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: /Vendors/i }).waitFor({ timeout: 15000 });

  // 6) Create Vendor (same shared category as request)
  await page.getByRole('button', { name: /Create Vendor/i }).click();
  await page.getByRole('heading', { name: /Create Vendor/i }).waitFor({ timeout: 15000 });

  // Vendor Details
  await page.getByPlaceholder(/ABC Supplies/i).fill(vendor.name);
  vendorCategory = await selectVendorCategory(page, sharedCategory);
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

  await perf.step('Operations request + task workflow', async () => {
  // 8) Operations → Requests
  await page.goto('https://test.propexcel.com/operations', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: /Operations Dashboard/i }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Requests', exact: true }).click();
  await page.waitForURL(/\/operations\/requests/, { timeout: 15000 });
  await page.getByRole('heading', { name: /^Requests$/i }).waitFor({ timeout: 15000 });

  // 9) Open submitted request from this run
  const requestCard = page.getByText(new RegExp(`^${escapeRegExp(requestTitle)}$`, 'i')).first();
  await requestCard.waitFor({ state: 'visible', timeout: 30000 });
  await requestCard.click();
  await page.getByRole('heading', { name: new RegExp(requestTitle, 'i') }).waitFor({ timeout: 15000 });

  // 10) Start Progress
  await page.getByRole('button', { name: /Start Progress/i }).click();
  await page.getByRole('button', { name: /Add task/i }).waitFor({ state: 'visible', timeout: 30000 });

  // 11) Add task
  const existingTaskOnRequest = page.getByText(new RegExp(`^${escapeRegExp(taskTitle)}$`, 'i')).first();
  if (await existingTaskOnRequest.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('Task already exists on request — skipping Add Task dialog');
  } else {
  await page.getByRole('button', { name: /Add task/i }).click();

  const taskDialog = page.getByRole('dialog', { name: /Add Task/i });
  await taskDialog.getByRole('heading', { name: /Add Task/i }).waitFor({ timeout: 15000 });
  await taskDialog.getByText(/^Status\s*\*$/i).waitFor({ state: 'visible', timeout: 30000 });
  await taskDialog.getByRole('textbox', { name: /Title/i }).waitFor({ state: 'visible', timeout: 15000 });

  await taskDialog.getByRole('textbox', { name: /Title/i }).fill(taskTitle);

  const taskStatus = await selectTaskDialogFieldByLabel(page, taskDialog, 'Status', 'Task Status', 'Open');
  const taskPriority = await selectTaskDialogFieldByLabel(page, taskDialog, 'Priority', 'Task Priority');
  const assignedVendor = await assignVendorInTaskDialog(page, taskDialog, vendor.name);

  // 12) Save Task
  await taskDialog.getByRole('button', { name: /^Save Task$/i }).click();

  await expect(page.getByText(new RegExp(taskTitle, 'i')).first()).toBeVisible({ timeout: 30000 });
  console.log('Task created:', {
    title: taskTitle,
    status: taskStatus,
    priority: taskPriority,
    vendor: assignedVendor,
  });
  }

  // 13) Left sidebar → Tasks
  await page.getByRole('button', { name: /^Tasks$/i }).click();
  await page.waitForURL(/\/operations\/tasks/, { timeout: 15000 });
  await expect(page.getByText(new RegExp(taskTitle, 'i')).first()).toBeVisible({ timeout: 30000 });
  console.log('Task visible on Tasks page:', taskTitle);

  // 14) Open task from Open column
  await page.getByText(new RegExp(`^${escapeRegExp(taskTitle)}$`, 'i')).first().click();
  await page.getByRole('heading', { name: new RegExp(taskTitle, 'i') }).waitFor({ timeout: 15000 });

  // 15) Change Status: Open → Done (Details panel uses buttons, not combobox)
  const detailsRegion = page.getByRole('region', { name: 'Details' });
  await detailsRegion.waitFor({ state: 'visible', timeout: 15000 });

  const statusValueBtn = detailsRegion
    .locator('div')
    .filter({ has: page.getByRole('button', { name: 'Status', exact: true }) })
    .getByRole('button')
    .nth(1);
  await statusValueBtn.click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  // 16) Wait for status update
  await expect(detailsRegion.getByText(/^Done$/i).first()).toBeVisible({ timeout: 30000 });
  await page.getByText(/updated|saved|success/i).first()
    .waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined);
  console.log('Task marked Done:', taskTitle);

  // 17) Back to Tasks board
  await page.getByRole('button', { name: /^Back$/i }).click();
  await page.waitForURL(/\/operations\/tasks/, { timeout: 15000 });

  // 18) Requests in sidebar
  await page.getByRole('button', { name: 'Requests', exact: true }).click();
  await page.waitForURL(/\/operations\/requests/, { timeout: 15000 });
  await page.getByRole('heading', { name: /^Requests$/i }).waitFor({ timeout: 15000 });

  // 19) Open request in In Progress
  const inProgressRequest = page.getByText(new RegExp(`^${escapeRegExp(requestTitle)}$`, 'i')).first();
  await inProgressRequest.waitFor({ state: 'visible', timeout: 30000 });
  await inProgressRequest.click();
  await page.getByRole('heading', { name: new RegExp(requestTitle, 'i') }).waitFor({ timeout: 15000 });

  // 20) Request for tenant approval
  await page.getByRole('button', { name: /Request for Tenant Approval/i }).click();
  await page.getByText(/Tenant Approval Pending|approval/i).first()
    .waitFor({ state: 'visible', timeout: 30000 }).catch(() => undefined);
  console.log('Tenant approval requested for:', requestTitle);

  // 21) Logout Super Admin
  await logoutSuperAdmin(page, admin.orgName);

  });

  await perf.step('Tenant request approval', async () => {
  // 22) Login as tenant again
  await fillLoginForm(page, tenant.orgId || admin.orgId, tenant.email, tenant.password);
  await page.waitForURL(
    (url) => url.hostname.includes('test.propexcel.com') && !url.pathname.includes('/login'),
    { timeout: 60000 },
  );
  console.log('Tenant re-logged in:', tenant.email);

  // 23) Left sidebar → Requests (wait for tenant shell first)
  await page.getByRole('heading', { name: /Tenant Dashboard|Requests/i }).first()
    .waitFor({ state: 'visible', timeout: 30000 });
  const requestsNav = page.getByRole('navigation').getByRole('button', { name: /^Requests$/i });
  await requestsNav.waitFor({ state: 'visible', timeout: 30000 });
  await requestsNav.click();
  await page.waitForURL(/\/tenant\/requests/, { timeout: 15000 });
  await page.getByRole('heading', { name: /^Requests$/i }).waitFor({ timeout: 15000 });

  // 24) Open this run's request from Tenant Approval Pending
  const pendingSection = page
    .locator('section, div, [role="region"]')
    .filter({ hasText: /Tenant Approval Pending/i })
    .first();

  let tenantRequest = pendingSection
    .getByText(new RegExp(`^${escapeRegExp(requestTitle)}$`, 'i'))
    .first();

  if (!(await tenantRequest.isVisible({ timeout: 8000 }).catch(() => false))) {
    // Fallback: list/table layout — click title near pending status
    tenantRequest = page
      .getByText(new RegExp(`^${escapeRegExp(requestTitle)}$`, 'i'))
      .first();
  }

  await tenantRequest.waitFor({ state: 'visible', timeout: 30000 });
  await tenantRequest.click();
  await page.getByRole('heading', { name: new RegExp(requestTitle, 'i') }).waitFor({ timeout: 15000 });
  await expect(page.getByText(/Tenant Approval Pending/i).first()).toBeVisible({ timeout: 15000 });
  console.log('Tenant opened approval-pending request:', requestTitle);

  // 25) Approve request
  await page.getByRole('button', { name: /Approve Request/i }).click();

  // 26) Wait for completed / success
  await expect(
    page.getByText(/Completed|Approved|successfully|Approval Completed/i).first(),
  ).toBeVisible({ timeout: 30000 });
  console.log('Tenant approved request:', requestTitle);

  // 27) Logout tenant
  await logoutTenant(page, tenant.fullName);

  });

  await perf.step('Bill create + payment', async () => {
  // 28) Login Super Admin (from org.json)
  await fillLoginForm(page, admin.orgId, admin.email, admin.password);
  await dismissEndToEndFlowTour(page);
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60000 });

  // 29) Accounts → Bills (left sidebar)
  await page.goto('https://test.propexcel.com/accounts/bills', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: /Bills/i }).first().waitFor({ timeout: 20000 });
  const billsNav = page.getByRole('navigation').getByRole('button', { name: /^Bills$/i });
  if (await billsNav.isVisible({ timeout: 5000 }).catch(() => false)) {
    await billsNav.click();
    await page.waitForURL(/\/accounts\/bills/, { timeout: 15000 });
  }

  // 30) Create Bill
  await page.getByRole('button', { name: /Create Bill/i }).click();
  await page.getByRole('heading', { name: /New Bill/i }).waitFor({ timeout: 15000 });

  // 31) Reference Number
  refNo = `REF-${suffix}`;
  await page.getByPlaceholder(/Enter reference number/i).fill(refNo);

  // 32) Vendor (combo) — vendor created in this run
  await selectBillCombobox(page, 'Vendor', 'Vendor', new RegExp(escapeRegExp(vendor.name), 'i'));

  // 33) Tenant
  await selectBillCombobox(
    page,
    'Tenant',
    'Tenant',
    new RegExp(escapeRegExp(tenant.fullName), 'i'),
  );

  // 34) Related Request
  await selectBillCombobox(
    page,
    'Related Request',
    'Related Request',
    new RegExp(escapeRegExp(requestTitle), 'i'),
  );

  // 35) Related Task
  await selectBillCombobox(
    page,
    'Related Task',
    'Related Task',
    new RegExp(escapeRegExp(taskTitle), 'i'),
  );

  // 35b) Property (combo) — same property from Flow 1 New Org / tenant-new-org.json
  await selectBillCombobox(
    page,
    'Property',
    'Property',
    new RegExp(escapeRegExp(tenant.propertyName), 'i'),
  );

  // 36–41) Add Item → fill line item → Save
  await page.getByRole('button', { name: /Add Item/i }).click();
  billItemName = itemNameForCategory(sharedCategory);
  const quantity = String(1 + Math.floor(Math.random() * 5));
  const unitPrice = String(100 + Math.floor(Math.random() * 900));
  await fillBillLineItem(page, billItemName, quantity, unitPrice, vendorCategory);

  console.log('Bill line item saved:', {
    reference: refNo,
    vendor: vendor.name,
    tenant: tenant.fullName,
    property: tenant.propertyName,
    request: requestTitle,
    task: taskTitle,
    item: billItemName,
    quantity,
    unitPrice,
    chartOfAccount: `by vendor category: ${vendorCategory}`,
  });

  // 42) Submit Bill
  await page.getByRole('button', { name: /Submit Bill/i }).click();
  await expect(
    page.getByText(/Pending|submitted|success|Bill submitted/i).first(),
  ).toBeVisible({ timeout: 30000 });
  console.log('Bill submitted:', refNo);

  // 43) Open Pending bill (prefer detail page after submit; else Bills list)
  const makePaymentOnDetail = page.getByRole('button', { name: /^Make Payment$/i });
  if (!(await makePaymentOnDetail.isVisible({ timeout: 8000 }).catch(() => false))) {
    await page.goto('https://test.propexcel.com/accounts/bills', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /^Bills$/i }).waitFor({ timeout: 20000 });
    await page.keyboard.press('Escape').catch(() => undefined);

    // Ungrouped list is easier to click than portfolio tiles
    const listView = page.getByRole('button', { name: /^List$/i });
    if (await listView.isVisible({ timeout: 5000 }).catch(() => false)) {
      await listView.click();
    }
    const groupToggle = page.getByRole('button', { name: /^Group$/i });
    if (await groupToggle.getAttribute('aria-pressed').then((v) => v === 'true').catch(() => false)) {
      await groupToggle.click();
    }

    const billsSearch = page.getByRole('combobox', { name: /Search by Bills/i })
      .or(page.getByPlaceholder(/Search by Bills/i));
    if (await billsSearch.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await billsSearch.first().fill(vendor.name);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1500);
    }

    // If still grouped, expand the portfolio that contains this bill
    const portfolio = page.getByRole('heading', { name: /General Portfolio|Residential|Other/i }).first();
    if (await portfolio.isVisible({ timeout: 3000 }).catch(() => false)) {
      await portfolio.click();
      await page.waitForTimeout(1000);
    }

    // Open the bill card / row for this vendor
    const vendorOnBill = page.getByText(new RegExp(`^${escapeRegExp(vendor.name)}$`, 'i')).first();
    await vendorOnBill.waitFor({ state: 'visible', timeout: 30000 });
    await vendorOnBill.click();
  }

  await page.getByRole('button', { name: /^Make Payment$/i }).waitFor({ state: 'visible', timeout: 20000 });
  console.log('Opened pending bill:', refNo);

  // 44) Make Payment (bill detail)
  await page.getByRole('button', { name: /^Make Payment$/i }).click();
  await page.getByRole('heading', { name: /Make Payment/i }).waitFor({ timeout: 15000 });

  // 45) Ensure this bill is selected → Make Payment (n)
  const paymentRow = page
    .locator('tr, div')
    .filter({ hasText: new RegExp(escapeRegExp(refNo), 'i') })
    .first();
  await paymentRow.waitFor({ state: 'visible', timeout: 15000 });

  const checkbox = paymentRow.getByRole('checkbox')
    .or(paymentRow.locator('[role="checkbox"]'))
    .first();
  if (await checkbox.isVisible({ timeout: 3000 }).catch(() => false)) {
    const checked = await checkbox.isChecked().catch(() => false);
    if (!checked) {
      await checkbox.click();
    }
  }

  await page.getByRole('button', { name: /Make Payment\s*\(/i }).click();

  // 46) Confirm Payment → Chart of Account by vendor category
  const confirmDialog = page.getByRole('dialog').filter({ hasText: /Confirm Payment/i });
  await confirmDialog.waitFor({ state: 'visible', timeout: 15000 });

  await selectChartOfAccountByVendorCategory(page, confirmDialog, vendorCategory);

  // 47) Confirm Payment
  await confirmDialog.getByRole('button', { name: /Confirm Payment/i }).click();
  await expect(
    page.getByText(/Paid|success|Payment (confirmed|successful)|marked as paid/i).first(),
  ).toBeVisible({ timeout: 30000 });
  console.log('Bill paid:', refNo);

  invoiceAmount = String(Number(quantity) * Number(unitPrice));

  });

  await perf.step('Admin invoice create', async () => {
  // 48) Accounts → Invoices (left sidebar)
  const invoicesNav = page.getByRole('navigation').getByRole('button', { name: /^Invoices$/i });
  if (await invoicesNav.isVisible({ timeout: 5000 }).catch(() => false)) {
    await invoicesNav.click();
  } else {
    await page.goto('https://test.propexcel.com/accounts/invoices', { waitUntil: 'domcontentloaded' });
  }
  await page.waitForURL(/\/accounts\/invoices/, { timeout: 15000 });
  await page.getByRole('heading', { name: /Invoices/i }).waitFor({ timeout: 15000 });

  // 49) Create Invoice
  await page.getByRole('button', { name: /Create Invoice/i }).click();

  // 50) Select tenant from this Flow 2 run
  await page.getByText('Search and select contact or tenant', { exact: true }).click();
  await page.getByPlaceholder('Search...').fill(tenant.fullName);
  const tenantOption = page.getByText(new RegExp(`${escapeRegExp(tenant.fullName)}.*\\(Tenant\\)`, 'i')).first();
  await tenantOption.waitFor({ state: 'visible', timeout: 15000 });
  await tenantOption.click();

  // 51–54) Line item from this run's bill (item, amount, Chart of Account 4000)
  const addLineItemBtn = page.getByRole('button', { name: 'Add Line Item' });
  if (await addLineItemBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await addLineItemBtn.click();
    await fillInvoiceLineItemWithRentalIncome(page, billItemName, invoiceAmount);
  } else {
    await page.locator('button.h-9.rounded-md.px-3.w-full.sm\\:w-auto').click();
    const amountInput = page.getByPlaceholder('0.00');
    await amountInput.fill(invoiceAmount);
    await amountInput.press('Enter');
    await page.getByRole('button', { name: 'Save' }).click();
  }

  // 55) Submit invoice
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

  await Promise.race([
    page.waitForURL(/\/accounts\/invoices\/\d+/, { timeout: 30000 }),
    page.getByText(/^INV-\d+/i).first().waitFor({ state: 'visible', timeout: 30000 }),
    page.getByRole('button', { name: /Receive Payment/i }).waitFor({ state: 'visible', timeout: 30000 }),
  ]);

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

  await expect(
    page.getByText(/^INV-\d+/i).or(page.getByRole('button', { name: /Receive Payment/i })).first(),
  ).toBeVisible({ timeout: 20000 });
  console.log('Invoice created from Flow 2 bill:', {
    tenant: tenant.fullName,
    item: billItemName,
    amount: invoiceAmount,
    reference: refNo,
  });

  // 56) Logout Super Admin
  await logoutSuperAdmin(page, admin.orgName);

  });

  await perf.step('Tenant Razorpay payment', async () => {
  // 57) Login as tenant
  await fillLoginForm(page, tenant.orgId || admin.orgId, tenant.email, tenant.password);
  await page.waitForURL(
    (url) => url.hostname.includes('test.propexcel.com') && !url.pathname.includes('/login'),
    { timeout: 60000 },
  );

  // 58) Tenant Invoices → open invoice → Pay Online via Razorpay
  await page.getByRole('heading', { name: /Tenant Dashboard|Invoices/i }).first()
    .waitFor({ state: 'visible', timeout: 30000 });
  const tenantInvoicesNav = page.getByRole('navigation').getByRole('button', { name: /^Invoices$/i });
  if (await tenantInvoicesNav.isVisible({ timeout: 8000 }).catch(() => false)) {
    await tenantInvoicesNav.click();
  } else {
    await page.goto('https://test.propexcel.com/tenant/invoices', { waitUntil: 'domcontentloaded' });
  }
  await page.waitForURL(/\/tenant\/invoices/, { timeout: 15000 });
  await page.getByRole('heading', { name: /Invoices/i }).waitFor({ timeout: 15000 });

  const clearStatus = page.getByRole('button', { name: /Clear selection/i });
  if (await clearStatus.isVisible({ timeout: 2000 }).catch(() => false)) {
    await clearStatus.click();
  }

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
  console.log('Tenant paid Flow 2 invoice via Razorpay');
  });

  const perfReport = perf.buildReport({
    flow: 'Flow2-NewOrganization',
    orgId: admin.orgId,
    orgName: admin.orgName,
    tenantEmail: tenant.email,
    tenantName: tenant.fullName,
  });
  perf.logSummary(perfReport);
  saveFlowPerformance('flow2-new-org-performance', perfReport);
});
