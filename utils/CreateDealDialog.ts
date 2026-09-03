import type { Locator, Page } from '@playwright/test';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Select an existing contact in the Create Deal slide-over.
 * Scoped to the dialog only — page-wide locators can match deal cards behind the drawer.
 *
 * Search uses the person full name / email (what CRM search indexes).
 * Optional `matchAlso` covers Company contacts whose dropdown row shows company name.
 */
export async function selectContactInCreateDealDialog(
  page: Page,
  dealDialog: Locator,
  searchName: string,
  options?: { matchAlso?: string[] },
): Promise<void> {
  const matchParts = [searchName, ...(options?.matchAlso ?? [])]
    .map((v) => v?.trim())
    .filter((v): v is string => !!v && v.length > 0);
  const uniqueParts = [...new Set(matchParts)];
  const matchRe = new RegExp(uniqueParts.map(escapeRegExp).join('|'), 'i');

  const searchBox = dealDialog
    .getByPlaceholder(/Search by Name, Email or Phone|Search and select|Search/i)
    .or(dealDialog.getByRole('textbox', { name: /Search/i }))
    .or(dealDialog.getByRole('combobox', { name: /Search|Contact|Select contact/i }))
    .first();
  await searchBox.waitFor({ state: 'visible', timeout: 15000 });
  await searchBox.click();
  await searchBox.fill('');
  await searchBox.fill(searchName);
  await page.waitForTimeout(800);

  const rowBase = dealDialog
    .locator('[cursor="pointer"], .cursor-pointer')
    .filter({ hasText: /(Contact|Company)\s*•/i })
    .filter({ hasNotText: /Create New Deal/i });

  let contactRow = rowBase.filter({ hasText: matchRe }).first();
  if (!(await contactRow.isVisible({ timeout: 5000 }).catch(() => false))) {
    // Retry search with email-like token if present in matchAlso
    const emailLike = uniqueParts.find((p) => p.includes('@'));
    if (emailLike && emailLike !== searchName) {
      await searchBox.fill('');
      await searchBox.fill(emailLike);
      await page.waitForTimeout(800);
      contactRow = rowBase.filter({ hasText: matchRe }).first();
    }
  }

  // Last resort: any Contact/Company row after search (single-result lists)
  if (!(await contactRow.isVisible({ timeout: 3000 }).catch(() => false))) {
    contactRow = rowBase.first();
  }

  await contactRow.waitFor({ state: 'visible', timeout: 20000 });
  await contactRow.scrollIntoViewIfNeeded().catch(() => undefined);
  await contactRow.click({ force: true }).catch(async () => {
    await contactRow.evaluate((el) => (el as HTMLElement).click());
  });
  // Contact pick often re-renders the drawer — give React a beat to settle.
  await page.waitForTimeout(500);
}

/**
 * Click Create/Save in the Create Deal dialog, re-querying after contact selection
 * so a detached button from drawer re-render does not fail the test.
 */
export async function submitCreateDealDialog(page: Page, dealDialog: Locator): Promise<void> {
  const deadline = Date.now() + 30000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const dialog = page.getByRole('dialog').filter({ hasText: /Create (New )?Deal|New Deal/i }).first();
      await dialog.waitFor({ state: 'visible', timeout: 5000 });

      const submitDeal = dialog
        .getByRole('button', { name: /Create Deal|^Create$|^Save$|^Submit$/i })
        .last();
      await submitDeal.waitFor({ state: 'attached', timeout: 5000 });
      await expectEnabled(submitDeal, 10000);
      await submitDeal.click({ timeout: 10000 });
      return;
    } catch (err) {
      lastError = err;
      await page.waitForTimeout(400);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Failed to submit Create Deal dialog');
}

async function expectEnabled(locator: Locator, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await locator.isEnabled().catch(() => false)) return;
    await locator.page().waitForTimeout(200);
  }
  // Final check — throw Playwright-style if still disabled
  if (!(await locator.isEnabled().catch(() => false))) {
    throw new Error('Create Deal submit button stayed disabled');
  }
}
