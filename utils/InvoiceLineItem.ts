import type { Page } from '@playwright/test';

/** Fill invoice Line Item dialog: Chart of Account 4000 + amount (search portal is outside dialog). */
export async function fillInvoiceLineItemWithRentalIncome(page: Page, amount: string) {
  const lineItemDialog = page.getByRole('dialog').filter({ hasText: /Line Item/i }).last();
  await lineItemDialog.getByRole('heading', { name: /Line Item/i }).waitFor({ timeout: 15000 });

  const itemField = lineItemDialog.getByLabel(/^Item$/i);
  if (await itemField.isVisible({ timeout: 2000 }).catch(() => false)) {
    await itemField.fill('rent');
  }

  const propertyCombo = lineItemDialog.getByRole('combobox', { name: /^Property$/i });
  if (await propertyCombo.isVisible({ timeout: 2000 }).catch(() => false)) {
    const propText = ((await propertyCombo.textContent().catch(() => '')) ?? '').trim();
    if (!propText || /select|search|property/i.test(propText)) {
      await propertyCombo.click();
      const firstProp = page.getByRole('option').first();
      if (await firstProp.isVisible({ timeout: 5000 }).catch(() => false)) {
        await firstProp.click();
      } else {
        await page.keyboard.press('Escape');
      }
    }
  }

  const chartCombo = lineItemDialog
    .getByRole('combobox', { name: /Select Account|Chart of Account|1000 - Cash|4000 - Rental/i })
    .or(lineItemDialog.getByRole('combobox').filter({ hasText: /1000 - Cash|Select Account|4000 - Rental/i }))
    .first();

  if (await chartCombo.isVisible({ timeout: 5000 }).catch(() => false)) {
    const expanded = await chartCombo.getAttribute('aria-expanded').catch(() => null);
    if (expanded !== 'true') {
      await chartCombo.click();
    }
  } else {
    const chartLabel = lineItemDialog.getByText(/^Chart of Account$/i);
    await chartLabel.locator('xpath=following::*[@role="combobox"][1]').click();
  }

  // Combobox search/options are portaled outside the dialog
  const accountSearch = page.getByRole('textbox', { name: /Search/i })
    .or(page.getByPlaceholder(/Search/i))
    .last();
  if (await accountSearch.isVisible({ timeout: 5000 }).catch(() => false)) {
    await accountSearch.fill('4000');
  }

  const rentalIncome = page.getByRole('option', { name: /4000\s*-\s*Rental Income/i });
  await rentalIncome.first().waitFor({ state: 'visible', timeout: 10000 });
  await rentalIncome.first().click();
  console.log('Chart of Account -> 4000 - Rental Income');

  const amountField = lineItemDialog.getByRole('spinbutton')
    .or(lineItemDialog.getByPlaceholder('0.00'))
    .or(lineItemDialog.getByLabel(/^Amount$/i))
    .first();
  await amountField.fill(amount);

  await lineItemDialog.getByRole('button', { name: /^Save$/i }).click();
  await lineItemDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => undefined);
}
