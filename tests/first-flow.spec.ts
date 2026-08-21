import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'https://test.propexcel.com';

const ORG_ID = process.env.PROPEX_ORG_ID ?? 'test53';
const EMAIL = process.env.PROPEX_EMAIL ?? 'test53@yopmail.com';
const PASSWORD = process.env.PROPEX_PASSWORD ?? 'Test2026$';

test.describe('PropExcel - First Flow End to End', () => {
  test('Create Property -> Contact -> Lead -> Deal -> Contract -> Move In -> Invoice -> Payment', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await page.setViewportSize({ width: 1850, height: 374 });

    // ---------------------------------------------------------------------
    // LOGIN
    // ---------------------------------------------------------------------
    await page.goto(`${BASE_URL}/login`);
    await expect(page).toHaveTitle(/PropExcel/i);

    await page.locator('#tenantId').fill(ORG_ID);
    await page.locator('#email').fill(EMAIL);
    await page.locator('#password').fill(PASSWORD);

    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page).toHaveURL(/accounts\/invoice-payments/);

    // ---------------------------------------------------------------------
    // PROPERTY
    // ---------------------------------------------------------------------
    await page.getByRole('button', { name: '+ Create Property' }).click();

    await page
      .getByRole('button', {
        name: /Office \/ Building Manage multi-unit buildings, commercial towers, floors, and traditional leases\./,
      })
      .click();

    await page.getByLabel('Enter property title').fill('My workzzz');

    /*
     * The recording opens these custom dropdowns, but does not record
     * which option was selected. The helper below selects an option by
     * visible text when you know the required value.
     *
     * Replace the values in SELECTED_* if your test data requires a
     * particular category/property/tax.
     */
    const SELECTED_CATEGORY = process.env.PROPEX_PROPERTY_CATEGORY;
    const SELECTED_PROPERTY = process.env.PROPEX_PROPERTY_TYPE;
    const SELECTED_TAX = process.env.PROPEX_TAX;

    await page.getByText('Select category', { exact: true }).click();
    if (SELECTED_CATEGORY) {
      await page.getByText(SELECTED_CATEGORY, { exact: true }).last().click();
    }

    await page.getByText('Select property', { exact: true }).click();
    if (SELECTED_PROPERTY) {
      await page.getByText(SELECTED_PROPERTY, { exact: true }).last().click();
    }

    // The recording opens the unit selector/icon here.
    const propertyUnitSelector = page.locator(
      'form div.lg\\:grid-cols-4 > div:nth-of-type(3) div > svg'
    );
    if (await propertyUnitSelector.count()) {
      await propertyUnitSelector.first().click();
    }

    await page.getByLabel('Enter property size').fill('3000');

    await page.getByText('Select Tax', { exact: true }).click();
    if (SELECTED_TAX) {
      await page.getByText(SELECTED_TAX, { exact: true }).last().click();
    }

    await page.getByLabel('Rental price for Monthly').fill('50000');

    // The original recording clicks the form area after entering the price.
    // Pressing Enter is safer than relying on a positional click.
    await page.getByLabel('Rental price for Monthly').press('Enter').catch(() => {});

    await page.getByRole('button', { name: 'Back to Properties' }).click();

    // ---------------------------------------------------------------------
    // CONTACT
    // ---------------------------------------------------------------------
    // Open sidebar if it is collapsed.
    const sidebarToggle = page.locator('header svg').nth(5);
    if (await sidebarToggle.count()) {
      await sidebarToggle.click().catch(() => {});
    }

    await page.getByText('Contacts', { exact: true }).click();
    await page.getByRole('button', { name: 'Create Contact' }).click();

    await page.getByLabel('Enter full name').fill('naga');

    const contactEmail = page.getByLabel('name@example.com').first();
    await contactEmail.fill('nagateja@yopmail.com');

    await page.getByLabel('Enter mobile number').fill('87657887689');

    await page.getByText('Enter nationality', { exact: true }).click();

    const nationalitySearch = page.getByRole('textbox', { name: 'Search...' }).last();
    if (await nationalitySearch.count()) {
      await nationalitySearch.fill('indian');
      const indianOption = page.getByText(/Indian/i).last();
      if (await indianOption.count()) {
        await indianOption.click();
      }
    }

    const createContactDialog = page.getByRole('dialog', { name: /Create Contact/i });
    await createContactDialog.getByRole('button', { name: /Create/i }).last().click();

    await page.getByRole('heading', { name: 'naga' }).click();

    // ---------------------------------------------------------------------
    // LEAD
    // ---------------------------------------------------------------------
    await page.getByRole('button', { name: 'Create Lead' }).click();

    /*
     * The recording opens Source, Status, Contact Method, Type and Purpose,
     * but the actual selected option is not captured. Select these through
     * environment variables when required.
     */
    const leadSource = process.env.PROPEX_LEAD_SOURCE;
    const leadStatus = process.env.PROPEX_LEAD_STATUS;
    const contactMethod = process.env.PROPEX_CONTACT_METHOD;
    const leadType = process.env.PROPEX_LEAD_TYPE;
    const leadPurpose = process.env.PROPEX_LEAD_PURPOSE;

    await page.getByText('Select source', { exact: true }).click();
    if (leadSource) {
      await page.getByText(leadSource, { exact: true }).last().click();
    }

    await page.getByText('Select status', { exact: true }).click();
    if (leadStatus) {
      await page.getByText(leadStatus, { exact: true }).last().click();
    }

    await page.getByText('Select Contact Method...', { exact: true }).click();
    if (contactMethod) {
      await page.getByText(contactMethod, { exact: true }).last().click();
    }

    await page.getByText('Select type', { exact: true }).click();
    if (leadType) {
      await page.getByText(leadType, { exact: true }).last().click();
    }

    await page.getByText('Select purpose...', { exact: true }).click();
    if (leadPurpose) {
      await page.getByText(leadPurpose, { exact: true }).last().click();
    }

    // Select property.
    await page.getByText('Select Property', { exact: true }).click();

    // The recording only captures opening the property selector.
    // If the property name is available, select it.
    const propertyName = 'My workzzz';
    const propertyOption = page.getByText(propertyName, { exact: true }).last();
    if (await propertyOption.count()) {
      await propertyOption.click();
    }

    await page.getByLabel('e.g., Dubai').fill('guntur');

    await page.getByRole('button', { name: 'Create' }).click();

    // ---------------------------------------------------------------------
    // CONVERT LEAD TO DEAL
    // ---------------------------------------------------------------------
    await page.getByRole('button', { name: 'Convert to Deal' }).click();

    await page.getByText('Select payment', { exact: true }).click();

    const dealPayment = process.env.PROPEX_DEAL_PAYMENT;
    if (dealPayment) {
      await page.getByText(dealPayment, { exact: true }).last().click();
    }

    const convertDialog = page.getByRole('dialog', { name: /Convert to Deal/i });
    await convertDialog.getByRole('button').last().click();

    // ---------------------------------------------------------------------
    // DEAL
    // ---------------------------------------------------------------------
    await page.getByText('Deals', { exact: true }).click();

    // Open the deal for contact "naga".
    await page.getByRole('heading', { name: 'naga' }).click();

    // Add Property.
    await page.getByRole('button', { name: 'Add Property' }).click();

    await page.getByText('All (Status)', { exact: true }).click();

    const propertySearch = page.getByRole('textbox', { name: 'Search...' }).last();
    if (await propertySearch.count()) {
      await propertySearch.fill('my');
    }

    const propertyResult = page.getByText('My workzzz', { exact: true }).last();
    if (await propertyResult.count()) {
      await propertyResult.click();
    }

    const addPropertyDialog = page.getByRole('dialog', { name: /Add Property/i });
    await addPropertyDialog.getByRole('button').last().click();

    // Approve Deal.
    await page.getByRole('button', { name: 'Approve Deal' }).click();

    // Create Contract.
    await page.getByRole('button', { name: 'Create Contract' }).click();

    // View Contract.
    await page.getByRole('button', { name: 'View Contract' }).click();

    // Close contract preview/modal if present.
    const closeButton = page.locator('div.fixed button').first();
    if (await closeButton.count()) {
      await closeButton.click().catch(() => {});
    }

    // ---------------------------------------------------------------------
    // CONTRACT
    // ---------------------------------------------------------------------
    await page.getByRole('button', { name: 'Approve Contract' }).click();

    await page.getByRole('button', { name: 'Action Buttons' }).click();

    await page
      .getByRole('button', {
        name: /Send Contract to Tenant/i,
      })
      .click();

    // Create Tenant.
    await page.getByRole('button', { name: /Create Tenant/i }).click();

    // Create Move-In Request.
    await page.getByText('Create a move-in', { exact: false }).click();

    await page.getByRole('button', { name: 'Confirm' }).click();

    // ---------------------------------------------------------------------
    // MOVE-IN REQUEST
    // ---------------------------------------------------------------------
    // Open the requests/notification area as in the recording.
    const headerMenu = page.locator('header > div:nth-of-type(2)').last();
    if (await headerMenu.count()) {
      await headerMenu.click().catch(() => {});
    }

    const moveInRequest = page.getByRole('heading', {
      name: /Move-in request for contract/i,
    }).first();

    if (await moveInRequest.count()) {
      await moveInRequest.click();
    }

    await page.getByRole('button', { name: 'Start Progress' }).click();
    await page.getByRole('button', { name: 'Complete Request' }).click();
    await page.getByRole('button', { name: 'Mark as Completed' }).click();

    // ---------------------------------------------------------------------
    // INVOICE
    // ---------------------------------------------------------------------
    await page.getByRole('button', { name: 'Invoices' }).click();

    await page.getByText('Search and select', { exact: true }).click();

    const invoiceCustomer = process.env.PROPEX_INVOICE_CUSTOMER ?? 'naga';
    const invoiceSearch = page.getByRole('textbox', { name: 'Search...' }).last();

    if (await invoiceSearch.count()) {
      await invoiceSearch.fill(invoiceCustomer);
      const customerOption = page.getByText(invoiceCustomer, { exact: true }).last();
      if (await customerOption.count()) {
        await customerOption.click();
      }
    }

    await page.getByRole('button', { name: 'Add Line Item' }).click();

    const lineItemDialog = page.getByRole('dialog').last();

    const lineItemSearch = lineItemDialog.getByRole('textbox').first();
    await lineItemSearch.fill('rent');

    const rentOption = lineItemDialog.getByText(/rent/i).last();
    if (await rentOption.count()) {
      await rentOption.click();
    }

    await lineItemDialog.getByText(/1000 - Cash \(Asset/i).click();

    const accountSearch = lineItemDialog.getByRole('textbox', { name: 'Search...' }).last();
    if (await accountSearch.count()) {
      await accountSearch.fill('400');
    }

    const amountInput = lineItemDialog.locator('div.grid input').first();
    await amountInput.fill('10000');

    await lineItemDialog.getByRole('button', { name: 'Save' }).click();

    await page.getByRole('button', { name: 'Submit' }).click();

    // ---------------------------------------------------------------------
    // RECEIVE PAYMENT
    // ---------------------------------------------------------------------
    await page.getByRole('button', { name: /Receive Payment/i }).click();

    await page.getByText('Select account...', { exact: true }).click();

    const paymentAccountSearch = page.getByRole('textbox', { name: 'Search...' }).last();
    if (await paymentAccountSearch.count()) {
      await paymentAccountSearch.fill('4000');

      const paymentAccount = page.getByText(/4000/i).last();
      if (await paymentAccount.count()) {
        await paymentAccount.click();
      }
    }

    await page.getByRole('button', { name: 'Save Payment' }).click();

    // Basic end-of-flow assertion.
    await expect(page).not.toHaveURL(/login/);
  });
});
