import type { Page } from '@playwright/test';

async function scrubOverlays(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.evaluate(() => {
    document.querySelectorAll(
      '#driver-popover-content, .driver-popover, .driver-overlay, iframe[src*="propexcel-end-to-end-flow"]',
    ).forEach((el) => el.remove());
    document.body.classList.remove('driver-active', 'driver-fade');
  }).catch(() => undefined);
}

async function gst18Visible(page: Page, timeoutMs = 5000): Promise<boolean> {
  const gstRow = page.getByRole('row').filter({ hasText: /GST-18|GST\s*\(\s*18\s*%\s*\)/i }).first();
  if (await gstRow.isVisible({ timeout: timeoutMs }).catch(() => false)) return true;
  return page.getByText(/GST-18|GST\s*\(\s*18\s*%\s*\)/i).first()
    .isVisible({ timeout: 1500 })
    .catch(() => false);
}

/**
 * Ensure GST (18%) / GST-18 exists on Accounts → Taxes.
 * Waits for the taxes table before checking (avoids race where Create Tax
 * is attempted while the list is still loading).
 */
export async function ensureGst18Tax(page: Page): Promise<void> {
  await scrubOverlays(page);
  await page.goto('https://test.propexcel.com/accounts/taxes', { waitUntil: 'domcontentloaded' });
  await scrubOverlays(page);
  await page.getByRole('heading', { name: /^Taxes$/i }).waitFor({ timeout: 30000 });

  // Wait until the list has settled (empty or populated).
  await Promise.race([
    page.getByText(/Showing\s+\d+\s+tax/i).waitFor({ timeout: 20000 }),
    page.getByRole('row').nth(1).waitFor({ state: 'visible', timeout: 20000 }),
    page.getByText(/no tax|0 taxes|empty/i).waitFor({ timeout: 20000 }),
  ]).catch(() => undefined);
  await page.waitForTimeout(800);

  if (await gst18Visible(page, 8000)) {
    console.log('GST (18%) already configured — skipping tax create');
    return;
  }

  const vatRow = page.getByRole('row').filter({ hasText: /\bVAT\b/i }).first();
  if (await vatRow.isVisible({ timeout: 3000 }).catch(() => false)) {
    const deleteBtn = vatRow.getByRole('button', { name: /Delete/i })
      .or(vatRow.locator('button[aria-label*="Delete" i]'))
      .or(vatRow.locator('button').last());
    await deleteBtn.click({ force: true });
    const confirmDelete = page.getByRole('dialog').getByRole('button', { name: /Delete|Confirm|Yes/i }).first();
    if (await confirmDelete.isVisible({ timeout: 4000 }).catch(() => false)) {
      await confirmDelete.click();
    }
    await vatRow.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => undefined);
    console.log('Deleted existing VAT tax');
    await page.goto('https://test.propexcel.com/accounts/taxes', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /^Taxes$/i }).waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
  }

  if (await gst18Visible(page, 5000)) {
    console.log('GST (18%) already configured — skipping tax create');
    return;
  }

  await scrubOverlays(page);

  const createTaxBtn = page.getByRole('button', { name: /^\+?\s*Tax$/i })
    .or(page.getByRole('button', { name: /\+?\s*(Create New Tax|Create Tax|Add Tax|New Tax)/i }))
    .first();
  await createTaxBtn.waitFor({ state: 'visible', timeout: 20000 });
  console.log('Creating new tax GST (18%)');
  await createTaxBtn.click({ force: true }).catch(async () => {
    await createTaxBtn.evaluate((el) => (el as HTMLElement).click());
  });

  const formHeading = page.getByRole('heading', {
    name: /Edit Tax|Create New Tax|Create.*Tax|New Tax|Tax Information|\+?\s*Tax/i,
  }).first();
  const formOpened = await formHeading.waitFor({ state: 'visible', timeout: 12000 }).then(() => true).catch(() => false);

  if (!formOpened) {
    // Click may have been a no-op or race — GST might already be listed now.
    if (await gst18Visible(page, 5000)) {
      console.log('GST (18%) already configured — skipping tax create');
      return;
    }
    throw new Error('Create Tax form did not open and GST (18%) is not listed');
  }

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

  await page.getByRole('button', { name: /Create Tax|Save|Submit/i }).first().click();
  await page.getByRole('heading', { name: /^Taxes$/i }).waitFor({ timeout: 30000 }).catch(() => undefined);
  await gst18Visible(page, 15000);
  console.log('Tax settings saved: GST (18%) / GST-18 / 18%');
}
