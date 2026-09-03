import type { Locator, Page } from '@playwright/test';

const COMPANY_NAMES = [
  'Acme Properties',
  'Skyline Realty',
  'Horizon Homes',
  'Vertex Estates',
  'Summit Housing',
  'Pinnacle Realty',
  'Oakwood Properties',
  'BlueHarbor Homes',
  'Cedar Gate Realty',
  'Ironwood Estates',
  'Lumen Properties',
  'Northstar Homes',
];

/** Random display company name for Create Contact → Company type. */
export function randomCompanyName(): string {
  const base = COMPANY_NAMES[Math.floor(Math.random() * COMPANY_NAMES.length)];
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${base} ${suffix}`;
}

/** Random company registration / CR number. */
export function randomCompanyRegistrationNumber(): string {
  const state = ['KA', 'MH', 'TN', 'DL', 'GJ'][Math.floor(Math.random() * 5)];
  const mid = String(Math.floor(10000 + Math.random() * 90000));
  const year = 2018 + Math.floor(Math.random() * 8);
  const serial = String(Math.floor(100000 + Math.random() * 900000));
  return `U${mid}${state}${year}PTC${serial}`;
}

/**
 * Select Contact/Lead Type = Company and fill Company Name + Registration Number.
 * Works for Create New Contact and Create New Lead dialogs.
 */
export async function selectCompanyContactTypeAndFill(
  dialog: Locator,
  options?: { companyName?: string; registrationNumber?: string },
): Promise<{ companyName: string; registrationNumber: string }> {
  const companyName = options?.companyName ?? randomCompanyName();
  const registrationNumber = options?.registrationNumber ?? randomCompanyRegistrationNumber();

  const companyRadio = dialog.getByRole('radio', { name: /^Company$/i }).first();
  if (await companyRadio.isVisible({ timeout: 5000 }).catch(() => false)) {
    await companyRadio.check({ force: true }).catch(async () => {
      await companyRadio.click({ force: true });
    });
  } else {
    const companyLabel = dialog.getByText(/^Company$/i).first();
    if (await companyLabel.isVisible({ timeout: 3000 }).catch(() => false)) {
      await companyLabel.click({ force: true });
    }
  }

  // Wait for Company Information section (may already be visible if Company is default after select)
  await dialog.getByText(/Company Information/i).first()
    .waitFor({ state: 'visible', timeout: 10000 })
    .catch(() => undefined);

  const companyNameField = dialog.getByRole('textbox', { name: /Enter company name/i })
    .or(dialog.getByPlaceholder(/Enter company name/i))
    .first();
  await companyNameField.waitFor({ state: 'visible', timeout: 15000 });
  await companyNameField.fill('');
  await companyNameField.fill(companyName);

  const regField = dialog.getByRole('textbox', { name: /Enter company registration number/i })
    .or(dialog.getByPlaceholder(/Enter company registration number/i))
    .first();
  if (await regField.isVisible({ timeout: 5000 }).catch(() => false)) {
    await regField.fill('');
    await regField.fill(registrationNumber);
  }

  console.log(`Company fields: name="${companyName}", reg="${registrationNumber}"`);
  return { companyName, registrationNumber };
}

/** Same helper when the dialog is scoped from page. */
export async function selectCompanyContactTypeOnPage(
  page: Page,
  options?: { companyName?: string; registrationNumber?: string },
): Promise<{ companyName: string; registrationNumber: string }> {
  const dialog = page.getByRole('dialog', { name: /Create New Contact/i }).first();
  return selectCompanyContactTypeAndFill(dialog, options);
}

/**
 * Prefer company display name for invoice Billed To, Create Deal contact pick, and deal search.
 * Falls back to fullName when companyName is absent.
 */
export function companyDisplayName(data: {
  companyName?: string;
  fullName: string;
}): string {
  const company = data.companyName?.trim();
  return company && company.length > 0 ? company : data.fullName;
}

/** @deprecated Use companyDisplayName — kept for existing imports. */
export function invoiceBilledToSearchName(data: {
  companyName?: string;
  fullName: string;
}): string {
  return companyDisplayName(data);
}
