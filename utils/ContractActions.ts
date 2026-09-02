import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Open the contract page (if needed), approve draft contracts, and wait until Active.
 */
export async function approveContractUntilActive(page: Page): Promise<void> {
  if (!page.url().includes('/accounts/contracts/')) {
    const viewContractBtn = page.getByRole('button', { name: 'View Contract' });
    await viewContractBtn.waitFor({ state: 'visible', timeout: 30000 });
    await viewContractBtn.click();
    const closePreview = page.locator('div.fixed button').first();
    if (await closePreview.isVisible({ timeout: 3000 }).catch(() => false)) {
      await closePreview.click();
    }
    if (!page.url().includes('/accounts/contracts/')) {
      await page.getByRole('button', { name: 'View Contract' }).click();
    }
    await page.waitForURL(/\/accounts\/contracts\//, { timeout: 30000 });
  }

  await page.getByRole('tab', { name: 'Contract Summary' }).click().catch(() => undefined);

  const approveContractBtn = page.getByRole('button', { name: 'Approve Contract' });
  const contractActive = page.getByText(/^Active$/i).first();

  if (await approveContractBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
    await approveContractBtn.scrollIntoViewIfNeeded().catch(() => undefined);
    await approveContractBtn.click();
    const approveContractDialog = page.getByRole('dialog');
    if (await approveContractDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
      await approveContractDialog.getByRole('button', { name: /Approve|Confirm|Yes|Submit/i }).click();
    }
    await contractActive.waitFor({ state: 'visible', timeout: 90000 });
    console.log('Contract approved');
    return;
  }

  if (await contractActive.isVisible({ timeout: 8000 }).catch(() => false)) {
    console.log('Contract already Active — skipping Approve Contract');
    return;
  }

  throw new Error('Approve Contract button not found and contract is not Active');
}

/**
 * Create Move In Request when available; skip if already exists or disabled (e.g. draft).
 */
export async function ensureMoveInRequest(page: Page, moveInDate: string): Promise<void> {
  await page.getByRole('tab', { name: 'Action Buttons' }).click();
  await page.getByRole('tabpanel', { name: 'Action Buttons' })
    .waitFor({ state: 'visible', timeout: 15000 })
    .catch(() => undefined);

  const moveInBtn = page.getByRole('button', { name: /Create Move In Request/i })
    .or(page.locator('button').filter({ has: page.getByRole('heading', { name: /Create Move In Request/i }) }))
    .first();
  const moveInExists = page.getByText(/Move-in request for contract|Tenant Move-in Date/i).first();

  if (await moveInExists.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('Move-in already exists — skipping Create Move In Request');
    return;
  }

  if (!(await moveInBtn.isVisible({ timeout: 8000 }).catch(() => false))
    || !(await moveInBtn.isEnabled().catch(() => false))) {
    console.log('Create Move In Request not available — skipping');
    return;
  }

  await moveInBtn.click();
  const moveInDialog = page.getByRole('dialog', { name: /Create Move-In Date/i });
  await moveInDialog.waitFor({ state: 'visible', timeout: 10000 });
  const dateField = moveInDialog.getByLabel('Tenant Move-in Date');
  await dateField.click();
  await dateField.fill('');
  await dateField.fill(moveInDate);
  await dateField.press('Tab').catch(() => undefined);
  const confirmMoveIn = moveInDialog.getByRole('button', { name: /^Confirm$/i });
  await expect(confirmMoveIn).toBeEnabled({ timeout: 10000 });
  await confirmMoveIn.click();
  const closed = await moveInDialog.waitFor({ state: 'hidden', timeout: 20000 }).then(() => true).catch(() => false);
  if (!closed) {
    console.log('Move-in dialog still open — retrying Confirm / Escape');
    await confirmMoveIn.click({ force: true }).catch(() => undefined);
    await moveInDialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(async () => {
      await page.keyboard.press('Escape');
      await moveInDialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
    });
  }
}
