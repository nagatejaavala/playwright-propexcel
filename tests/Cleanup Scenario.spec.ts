import { test, expect } from '@playwright/test';

const PLATFORM_ORG_ID = 'propexcel';
const PLATFORM_EMAIL = 'admin@propexcel.com';
const PLATFORM_PASSWORD = 'Demo2026$';
const SEARCH_TERM = 'Auto';

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
  const title = page.getByText(/PropExcel End-to-End Flow/i).first();
  if (!(await title.isVisible({ timeout: 8000 }).catch(() => false))) return;
  await page.keyboard.press('Escape');
  await title.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => undefined);
}

async function dismissNotificationsModal(page: import('@playwright/test').Page) {
  const title = page.getByText(/Notifications\s*&\s*Announcements/i).first();
  if (!(await title.isVisible({ timeout: 3000 }).catch(() => false))) return;
  await page.keyboard.press('Escape');
  await title.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => undefined);
}

async function dismissInstallPrompt(page: import('@playwright/test').Page) {
  const gotIt = page.getByRole('button', { name: /^Got it$/i });
  if (await gotIt.isVisible({ timeout: 3000 }).catch(() => false)) {
    await gotIt.click();
  }
}

async function goToOrganizationsList(page: import('@playwright/test').Page) {
  await dismissEndToEndFlowTour(page);
  await dismissNotificationsModal(page);
  await dismissInstallPrompt(page);

  const orgsSearch = page.getByPlaceholder(/Search organizations/i);
  if (await orgsSearch.isVisible({ timeout: 3000 }).catch(() => false)) {
    return;
  }

  const orgsModule = page.locator('button[aria-label="Organizations"]').first();
  await orgsModule.waitFor({ state: 'attached', timeout: 30000 });
  await orgsModule.evaluate((el) => (el as HTMLElement).click());

  const orgsNav = page.getByRole('button', { name: /^Organizations$/i })
    .or(page.getByRole('link', { name: /^Organizations$/i }))
    .first();

  if (await orgsNav.isVisible({ timeout: 10000 }).catch(() => false)) {
    await orgsNav.click();
  } else {
    await page.goto('https://test.propexcel.com/organizations/billing/organizations', {
      waitUntil: 'domcontentloaded',
    });
  }

  await orgsSearch.waitFor({ state: 'visible', timeout: 30000 });
}

/** Delete all org cards matching search term (e.g. auto7, auto8, …). */
async function deleteOrganizationsBySearch(page: import('@playwright/test').Page, searchTerm: string) {
  const search = page.getByPlaceholder(/Search organizations/i);
  await search.fill('');
  await search.fill(searchTerm);
  await page.waitForTimeout(1500);

  let deletedCount = 0;

  while (true) {
    const deleteBtn = page.getByRole('button', { name: /^Delete Organization$/i }).first();
    if (!(await deleteBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      break;
    }

    const card = deleteBtn.locator('xpath=ancestor::*[@cursor="pointer" or contains(@class, "cursor-pointer")][1]');
    const orgName = (await card.innerText().catch(() => '')).match(/auto\d+/i)?.[0] ?? 'organization';
    console.log(`Deleting organization: ${orgName}`);

    page.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toMatch(/permanently delete/i);
      console.log('Confirm dialog:', dialog.message());
      await dialog.accept();
    });

    await deleteBtn.click();
    await page.waitForTimeout(2500);

    deletedCount++;
    await search.fill('');
    await search.fill(searchTerm);
    await page.waitForTimeout(1500);
  }

  console.log(`Deleted ${deletedCount} organization(s) matching "${searchTerm}"`);
}

async function logoutAdmin(page: import('@playwright/test').Page) {
  const profileBtn = page.getByRole('button', { name: /Super Admin|propexcel|admin/i }).first();
  if (await profileBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await profileBtn.click();
  } else {
    await page.locator('header').getByRole('button').last().click();
  }

  await page.getByText('Logout', { exact: true }).click();
  await page.waitForURL(/\/login/, { timeout: 20000 });
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
}

test.describe('Cleanup Scenario', () => {
  test('delete auto organizations and logout', async ({ page }) => {
    test.setTimeout(180_000);

    await page.goto('https://test.propexcel.com/login', { waitUntil: 'domcontentloaded' });

    await fillLoginFields(page, PLATFORM_ORG_ID, PLATFORM_EMAIL, PLATFORM_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    const invalidCredentials = page.getByText(/Invalid credentials/i);
    if (await invalidCredentials.isVisible({ timeout: 5000 }).catch(() => false)) {
      throw new Error(`Platform login failed for ${PLATFORM_EMAIL} (password: ${PLATFORM_PASSWORD}).`);
    }

    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60000 });

    await goToOrganizationsList(page);
    await deleteOrganizationsBySearch(page, SEARCH_TERM);
    await logoutAdmin(page);

    console.log('Cleanup complete — back on login page');
  });
});
