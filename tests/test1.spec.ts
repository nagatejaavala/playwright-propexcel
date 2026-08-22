import { test, expect } from "@playwright/test";
import {
  captureTenantPasswordFromDialog,
  createTenantPasswordCapture,
  getTenantCredentialsFromYopmail,
  resolveTenantCredentials,
  startYopmailCredentialPolling,
} from "../utils/TenantCredentials";
import { saveSharedTenantData } from "../utils/SharedTenantData";

function generateTestData() {
  const suffix = Date.now().toString().slice(-6);
  return {
    fullName: `user${suffix}`,
    email: `user${suffix}@yopmail.com`,
    mobile: `9${Math.floor(100000000 + Math.random() * 900000000)}`,
    propertyName: `villa${suffix}`,
  };
}

function formatMoveInDate(date: Date = new Date()) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${year}-${month}-${day}`;
}

async function selectRandomFromCombobox(
  page: import('@playwright/test').Page,
  name: string,
) {
  await page.getByRole('combobox', { name }).click();

  let options = page.getByRole('option');
  if ((await options.count()) === 0) {
    options = page.locator('[role="listbox"] [role="option"], [role="listbox"] button');
  }

  await options.first().waitFor({ state: 'visible', timeout: 10000 });
  // Brief settle — list can re-render and detach option nodes
  await page.waitForTimeout(300);
  options = page.getByRole('option');
  if ((await options.count()) === 0) {
    options = page.locator('[role="listbox"] [role="option"], [role="listbox"] button');
  }

  const count = await options.count();
  if (count === 0) {
    throw new Error(`No options found for combobox: ${name}`);
  }

  const index = Math.floor(Math.random() * count);
  const label = ((await options.nth(index).textContent()) || '').trim();
  console.log(`${name} -> [${index + 1}/${count}] ${label}`);

  // Prefer stable re-query by visible text (avoids detached DOM mid-click)
  const byText = page.getByRole('option', { name: label, exact: true }).first();
  if (await byText.isVisible({ timeout: 2000 }).catch(() => false)) {
    await byText.click({ force: true });
  } else {
    await options.nth(index).click({ force: true });
  }

  // Ensure list closed before next combobox
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(200);
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

async function fillInvoiceLineItemWithRentalIncome(
  page: import('@playwright/test').Page,
  amount: string,
) {
  const lineItemDialog = page.getByRole('dialog').filter({ hasText: /Line Item/i }).last();
  await lineItemDialog.getByRole('heading', { name: /Line Item/i }).waitFor({ timeout: 15000 });

  const itemField = lineItemDialog.getByLabel(/^Item$/i);
  if (await itemField.isVisible({ timeout: 2000 }).catch(() => false)) {
    await itemField.fill('rent');
  }

  // Chart of Account — open combobox (default is often 1000 - Cash)
  const chartLabel = lineItemDialog.getByText(/^Chart of Account$/i);
  const chartCombo = lineItemDialog.getByRole('combobox').filter({
    hasText: /1000 - Cash|4000 - Rental Income|Chart of Account/i,
  }).first();

  if (await chartCombo.isVisible({ timeout: 3000 }).catch(() => false)) {
    await chartCombo.click();
  } else if (await chartLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
    await chartLabel.locator('xpath=following::*[@role="combobox"][1]').click();
  } else {
    await lineItemDialog.getByText(/1000 - Cash \(Asset/i).click();
  }

  const accountSearch = lineItemDialog.getByRole('textbox', { name: /Search/i }).last();
  await accountSearch.waitFor({ state: 'visible', timeout: 10000 });
  await accountSearch.fill('4000');

  const rentalIncome = lineItemDialog.getByRole('option', { name: /4000\s*-\s*Rental Income/i })
    .or(lineItemDialog.getByText(/4000\s*-\s*Rental Income.*Operating Revenue/i))
    .or(page.getByRole('option', { name: /4000\s*-\s*Rental Income/i }))
    .or(page.getByText(/4000\s*-\s*Rental Income.*Operating Revenue/i));

  await rentalIncome.first().waitFor({ state: 'visible', timeout: 10000 });
  await rentalIncome.first().click();
  console.log('Chart of Account -> 4000 - Rental Income');

  const amountField = lineItemDialog.getByLabel(/Amount.*Incl.*Tax/i)
    .or(lineItemDialog.getByPlaceholder('0.00'))
    .or(lineItemDialog.locator('div.grid input').first());
  await amountField.first().fill(amount);

  await lineItemDialog.getByRole('button', { name: /^Save$/i }).click();
  await lineItemDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => undefined);
}

test('Propexcel end-to-end flow', async ({ page, context }) => {
  const data = generateTestData();
  const moveInDate = formatMoveInDate();
  const passwordCapture = createTenantPasswordCapture(page);
  let yopmailCredentialsPromise: ReturnType<typeof startYopmailCredentialPolling> | undefined;
  let tenantPassword: string | undefined;
  console.log('Run data:', data, 'Move-in date:', moveInDate);

  test.setTimeout(600_000);
  page.setDefaultTimeout(30_000);
  await context.grantPermissions(['geolocation'], { origin: 'https://test.propexcel.com' });
      {

          await page.goto('https://test.propexcel.com/login', { waitUntil: 'domcontentloaded' });
          await page.getByRole('heading', { name: /Welcome Back/i }).waitFor({ timeout: 30000 });
          await fillLoginFields(page, 'test240', 'test240@yopmail.com', 'Test2026$');
          await page.getByRole('button', { name: 'Sign In' }).click();
          await page.getByRole('heading', { name: 'Properties' }).waitFor({ timeout: 60000 });
      }
      {

          await page.getByRole('button', { name: '+ Create Property' }).click();
          try {
            await page.waitForURL(/\/property\/properties\/create/, { timeout: 10000 });
          } catch {
            await page.getByRole('button', { name: '+ Create Property' }).click();
            await page.waitForURL(/\/property\/properties\/create/);
          }
          await page.getByRole('heading', { name: 'Create New Property' }).waitFor();
      }
      {

          await page.getByRole('button', { name: /Office \/ Building/ }).click();
      }
      {

          await page.locator("div:nth-of-type(1) > div:nth-of-type(1) > input").click();
          await page.locator("div:nth-of-type(1) > div:nth-of-type(1) > input").fill(data.propertyName);
      }
      {

          await selectRandomFromCombobox(page, 'Select category');
      }
      {

          await selectRandomFromCombobox(page, 'Select property group');
      }
      {

          //await page.locator("div.lg\\:grid-cols-4 input").click();
      }
      {

         // await page.locator("div.lg\\:grid-cols-4 input").fill('3000');
         // await page.locator("div.lg\\:grid-cols-4 input").fill('3000');
          await page.locator("div.lg\\:grid-cols-4 input[type='number']").fill('3000');


      }
      {

          await page.locator("div:nth-of-type(3) > div:nth-of-type(2) > div > div > div").click();
      }
      {

          await page.getByRole('textbox', { name: 'Rental price for Monthly' }).click();
      }
      {

          await page.getByRole('textbox', { name: 'Rental price for Monthly' }).fill('10000');
      }
      {

          await selectRandomFromCombobox(page, 'Select Tax');
      }
      {

          await page.getByRole('button', { name: 'Got it' }).click({ timeout: 5000 }).catch(() => {});
          await page.goto('https://test.propexcel.com/crm/contacts', { waitUntil: 'domcontentloaded' });
          await page.getByRole('heading', { name: 'Contacts Management' }).waitFor();
          await page.getByRole('button', { name: 'Create Contact' }).click();
          await page.getByRole('dialog', { name: 'Create New Contact' }).waitFor();
          await page.getByRole('textbox', { name: 'Enter full name' }).fill(data.fullName);
          await page.getByRole('textbox', { name: 'name@example.com' }).fill(data.email);
          await page.getByRole('textbox', { name: 'Enter mobile number' }).fill(data.mobile);
          await page.getByRole('combobox', { name: 'Enter nationality' }).click();
          await page.getByRole('textbox', { name: 'Search...' }).fill('indian');
          await page.getByRole('option', { name: 'Indian' }).click();
          const createDialog = page.getByRole('dialog', { name: 'Create New Contact' });
          await page.getByRole('button', { name: 'Create Contact' }).click();
          await createDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(async () => {
            if (await createDialog.isVisible()) {
              await createDialog.getByRole('button', { name: 'Close' }).click();
            }
          });
          await page.locator('h3').filter({ hasText: new RegExp(`^${data.fullName}$`, 'i') }).first().waitFor({ timeout: 15000 });
      }
      {

          await page.locator('h3').filter({ hasText: new RegExp(`^${data.fullName}$`, 'i') }).first().click();
          await page.getByRole('button', { name: 'Create Lead' }).click();

          const leadDialog = page.getByRole('dialog').filter({ hasText: 'Create New Lead' });
          const leadForm = await leadDialog.isVisible({ timeout: 10000 }).catch(() => false)
            ? leadDialog
            : page.getByRole('heading', { name: 'Create New Lead' }).locator('xpath=ancestor::main[1]');

          await leadForm.waitFor({ state: 'visible', timeout: 15000 });

          const scrollArea = leadForm.locator('div.overflow-y-auto, div[class*="overflow-y"]').last();
          if (await scrollArea.count()) {
            await scrollArea.evaluate((el) => { el.scrollTop = el.scrollHeight; });
          } else {
            await leadForm.evaluate((el) => { el.scrollTop = el.scrollHeight; });
          }

          const submitLeadBtn = leadForm.getByRole('button', { name: 'Create', exact: true }).last();
          await submitLeadBtn.scrollIntoViewIfNeeded();
          await expect(submitLeadBtn).toBeVisible();
          await expect(submitLeadBtn).toBeEnabled();
          await submitLeadBtn.click();
          try {
            await page.waitForURL(/\/crm\/leads\/(?!create)[^/]+$/, { timeout: 20000 });
          } catch {
            await leadForm.press('End');
            await submitLeadBtn.click({ force: true });
            await page.waitForURL(/\/crm\/leads\/(?!create)[^/]+$/, { timeout: 45000 });
          }
          await page.getByRole('button', { name: 'Convert to Deal' }).waitFor({ timeout: 30000 });
      }
      {

          await page.getByRole('button', { name: 'Convert to Deal' }).click();
          const convertDialog = page.getByRole('dialog', { name: /Convert Lead to Deal/i });
          await convertDialog.getByRole('combobox', { name: 'Select payment type...' }).click();
          await page.getByRole('option').first().click();
          await convertDialog.getByRole('button', { name: 'Convert to Deal' }).click();
          await convertDialog.waitFor({ state: 'hidden', timeout: 30000 });
          if (!page.url().includes('/crm/deals/')) {
            await page.goto('https://test.propexcel.com/crm/deals', { waitUntil: 'domcontentloaded' });
            await page.locator('h4').filter({ hasText: new RegExp(`^${data.fullName}$`, 'i') }).first().click();
          }
          await page.getByRole('heading', { name: 'Deal Details', level: 1 }).waitFor({ timeout: 30000 });
      }
      {

          await page.getByRole('button', { name: 'Add Property' }).click();
          const addPropertyDialog = page.getByRole('dialog', { name: 'Add Property to Deal' });
          await addPropertyDialog.getByRole('combobox', { name: 'Search...' }).fill(data.propertyName);
          const propertyCard = addPropertyDialog.getByRole('heading', { name: data.propertyName });
          if (await propertyCard.isVisible({ timeout: 5000 }).catch(() => false)) {
            await propertyCard.click();
          } else {
            await addPropertyDialog.locator('h3').first().click();
          }
          await addPropertyDialog.getByRole('button', { name: 'Add Property' }).click();
          await addPropertyDialog.waitFor({ state: 'hidden' });
      }
      {

          const propertyCard = page.locator('h4', { hasText: data.propertyName }).locator('xpath=ancestor::div[contains(@class,"rounded-2xl")]').first();
          const taxCombobox = propertyCard.getByRole('combobox');
          if (await taxCombobox.isVisible({ timeout: 3000 }).catch(() => false)) {
            const taxLabel = await taxCombobox.textContent();
            if (!taxLabel || taxLabel.includes('No selection')) {
              await taxCombobox.click();
              await page.getByRole('option', { name: 'GST (18%) (18.00%)' }).click();
              await propertyCard.getByRole('button', { name: 'Save' }).click();
            }
          }
      }
      {

          await page.getByRole('button', { name: 'Approve Deal' }).click();
          const approveDealDialog = page.getByRole('dialog');
          if (await approveDealDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
            await approveDealDialog.getByRole('button', { name: /Approve|Confirm|Yes|Submit/i }).click();
          }
      }
      {

          let viewContractBtn = page.getByRole('button', { name: 'View Contract' });
          if (!await viewContractBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            const createContractBtn = page.getByRole('button', { name: 'Create Contract' });
            await createContractBtn.waitFor({ state: 'visible', timeout: 15000 });
            await createContractBtn.click();
            const contractDialog = page.getByRole('dialog');
            if (await contractDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
              await contractDialog.getByRole('button', { name: /Create|Confirm|Yes|Submit/i }).click();
            }
            viewContractBtn = page.getByRole('button', { name: 'View Contract' });
            await viewContractBtn.waitFor({ state: 'visible', timeout: 120000 });
          }
          await viewContractBtn.click();
          const closePreview = page.locator('div.fixed button').first();
          if (await closePreview.isVisible({ timeout: 3000 }).catch(() => false)) {
            await closePreview.click();
          }
      }
      {

          await page.getByRole('button', { name: 'Approve Contract' }).click();
          const approveContractDialog = page.getByRole('dialog');
          if (await approveContractDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
            await approveContractDialog.getByRole('button', { name: /Approve|Confirm|Yes|Submit/i }).click();
          }
          await page.waitForURL(/\/accounts\/contracts\//, { timeout: 30000 }).catch(async () => {
            await page.getByRole('button', { name: 'View Contract' }).click();
            await page.waitForURL(/\/accounts\/contracts\//, { timeout: 30000 });
          });
      }
      {

          await page.getByRole('tab', { name: 'Action Buttons' }).click();
          await page.getByRole('button', { name: /Create Tenant User/i }).click();
          const tenantDialog = page.getByRole('dialog');
          if (await tenantDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
            await tenantDialog.getByRole('button', { name: /Create|Confirm|Yes|Submit/i }).click();
            const dialogPassword = await captureTenantPasswordFromDialog(page);
            if (dialogPassword) {
              passwordCapture.setPassword(dialogPassword);
              console.log('Tenant password captured from dialog');
            }
            await tenantDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
          }
          if (!passwordCapture.getPassword()) {
            yopmailCredentialsPromise = startYopmailCredentialPolling(context, data.email, page);
          }
      }
      {

          await page.getByRole('tab', { name: 'Action Buttons' }).click();
          await page.getByRole('button', { name: /Create Move In Request/i }).click();
          const moveInDialog = page.getByRole('dialog', { name: /Create Move-In Date/i });
          await moveInDialog.waitFor({ state: 'visible', timeout: 10000 });
          const dateField = moveInDialog.getByLabel('Tenant Move-in Date');
          await dateField.click();
          await dateField.fill(moveInDate);
          await moveInDialog.getByRole('button', { name: 'Confirm' }).click();
          await moveInDialog.waitFor({ state: 'hidden', timeout: 15000 });
      }
      {

          await page.goto('https://test.propexcel.com/operations', { waitUntil: 'domcontentloaded' });
          await page.getByRole('heading', { name: /Operations Dashboard/i }).waitFor({ timeout: 15000 });
          await page.getByRole('button', { name: 'Requests', exact: true }).click();
          await page.waitForURL(/\/operations\/requests/, { timeout: 15000 });
      }
      {

          await page.getByRole('heading', { name: 'Requests' }).waitFor({ timeout: 15000 });
          const latestMoveInRequest = page.getByText(/Move-in request for contract/i).first();
          await latestMoveInRequest.waitFor({ state: 'visible', timeout: 15000 });
          await latestMoveInRequest.click();
          await page.getByRole('button', { name: 'Start Progress' }).click();
          await page.getByRole('button', { name: 'Complete Request' }).click();
          await page.getByRole('button', { name: 'Mark as Completed' }).click();
      }
      {

          await page.getByRole('button', { name: 'Super Admin' }).click();
          await page.getByText('Logout', { exact: true }).click();
          await page.waitForURL(/\/login/, { timeout: 15000 });
      }
      {

          const tenantCredentials = await resolveTenantCredentials({
            capturedPassword: passwordCapture.getPassword(),
            yopmailPromise: yopmailCredentialsPromise,
            page,
            context,
            email: data.email,
          });
          tenantPassword = tenantCredentials.password;
          console.log('Tenant credentials:', {
            loginLink: tenantCredentials.loginLink,
            passwordLength: tenantCredentials.password?.length ?? 0,
            source: tenantCredentials.source,
          });

          if (tenantCredentials.password) {
            await page.goto('https://test.propexcel.com/login', { waitUntil: 'domcontentloaded' });
            await fillLoginFields(page, 'test240', data.email, tenantCredentials.password);
            await page.getByRole('button', { name: 'Sign In' }).click();

            const invalidCredentials = page.getByText('Invalid credentials');
            const leftLogin = page.waitForURL(
              (url) => url.hostname.includes('test.propexcel.com') && !url.pathname.includes('/login'),
              { timeout: 15000 },
            ).then(() => 'ok' as const).catch(() => null);
            const sawInvalid = invalidCredentials.waitFor({ state: 'visible', timeout: 15000 })
              .then(() => 'invalid' as const).catch(() => null);
            const loginResult = await Promise.race([leftLogin, sawInvalid]);

            if (loginResult === 'invalid') {
              console.log('Login failed — retrying with fresh YOPmail fetch');
              const retryCredentials = await getTenantCredentialsFromYopmail(page, data.email);
              tenantPassword = retryCredentials.password;
              const passwordField = page.getByRole('textbox', { name: /^Password$/i }).or(page.locator('#password'));
              await passwordField.first().fill('');
              await passwordField.first().fill(retryCredentials.password!);
              await page.getByRole('button', { name: 'Sign In' }).click();
            }
          } else if (tenantCredentials.loginLink?.includes('test.propexcel.com')) {
            await page.goto(tenantCredentials.loginLink, { waitUntil: 'domcontentloaded' });
          } else {
            throw new Error(`No tenant password available for ${data.email}`);
          }

          await page.waitForURL(
            (url) => url.hostname.includes('test.propexcel.com') && !url.pathname.includes('/login'),
            { timeout: 60000 },
          );
      }
      {

          const tenantProfile = page.getByRole('button', { name: new RegExp(data.fullName, 'i') });
          if (await tenantProfile.first().isVisible({ timeout: 5000 }).catch(() => false)) {
            await tenantProfile.first().click();
          } else {
            await page.locator('header').getByRole('button').last().click();
          }
          await page.getByText('Logout', { exact: true }).click();
          await page.waitForURL(/\/login/, { timeout: 15000 });
      }
      {

          await fillLoginFields(page, 'test240', 'test240@yopmail.com', 'Test2026$');
          await page.getByRole('button', { name: 'Sign In' }).click();
          await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60000 });
      }
      {

          await page.goto('https://test.propexcel.com/accounts/invoices', { waitUntil: 'domcontentloaded' });
          await page.getByRole('heading', { name: /Invoices/i }).waitFor({ timeout: 15000 });
          await page.getByRole('button', { name: /Create Invoice/i }).click();

          await page.getByText('Search and select contact or tenant', { exact: true }).click();
          await page.getByPlaceholder('Search...').fill(data.fullName);

          const tenantOption = page.getByText(new RegExp(`${data.fullName}.*\\(Tenant\\)`, 'i')).first();
          await tenantOption.waitFor({ state: 'visible', timeout: 15000 });
          await tenantOption.click();

          const addLineItemBtn = page.getByRole('button', { name: 'Add Line Item' });
          if (await addLineItemBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await addLineItemBtn.click();
            await fillInvoiceLineItemWithRentalIncome(page, '10000');
          } else {
            await page.locator('button.h-9.rounded-md.px-3.w-full.sm\\:w-auto').click();
            const amountInput = page.getByPlaceholder('0.00');
            await amountInput.fill('10000');
            await amountInput.press('Enter');
            await page.getByRole('button', { name: 'Save' }).click();
          }

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

          // Wait until invoice detail / success UI is shown
          await Promise.race([
            page.waitForURL(/\/accounts\/invoices\/\d+/, { timeout: 30000 }),
            page.getByText(/^INV-\d+/i).first().waitFor({ state: 'visible', timeout: 30000 }),
            page.getByRole('button', { name: /Receive Payment/i }).waitFor({ state: 'visible', timeout: 30000 }),
          ]);

          // If still Draft, try to publish / submit so tenant can see it
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

          // Strong success signals for a tenant-visible invoice
          await expect(
            page.getByText(/^INV-\d+/i).or(page.getByRole('button', { name: /Receive Payment/i })).first(),
          ).toBeVisible({ timeout: 20000 });

          const dueOrPaid = page.getByText(/^(DUE|Due|PAID|Paid)$/i).first();
          if (await dueOrPaid.isVisible({ timeout: 5000 }).catch(() => false)) {
            console.log('Invoice status:', (await dueOrPaid.textContent())?.trim());
          }
          console.log('Invoice created successfully');
      }
      {

          // Logout Super Admin after creating invoice
          await page.getByRole('button', { name: 'Super Admin' }).click();
          await page.getByText('Logout', { exact: true }).click();
          await page.waitForURL(/\/login/, { timeout: 15000 });
      }
      {

          // Login again as tenant
          if (!tenantPassword) {
            const refreshed = await resolveTenantCredentials({
              capturedPassword: passwordCapture.getPassword(),
              yopmailPromise: yopmailCredentialsPromise,
              page,
              context,
              email: data.email,
            });
            tenantPassword = refreshed.password;
          }
          if (!tenantPassword) {
            throw new Error(`No tenant password available for second login: ${data.email}`);
          }

          await page.goto('https://test.propexcel.com/login', { waitUntil: 'domcontentloaded' });
          await fillLoginFields(page, 'test240', data.email, tenantPassword);
          await page.getByRole('button', { name: 'Sign In' }).click();
          await page.waitForURL(
            (url) => url.hostname.includes('test.propexcel.com') && !url.pathname.includes('/login'),
            { timeout: 60000 },
          );
      }
      {

          // Tenant portal: Invoices → pay online via Razorpay
          await page.goto('https://test.propexcel.com/tenant/invoices', { waitUntil: 'domcontentloaded' });
          await page.getByRole('heading', { name: /Invoices/i }).waitFor({ timeout: 15000 });

          // Prefer sidebar navigation as well
          const invoicesNav = page.getByRole('button', { name: 'Invoices', exact: true });
          if (await invoicesNav.isVisible({ timeout: 3000 }).catch(() => false)) {
            await invoicesNav.click();
            await page.waitForTimeout(1000);
          }

          const clearStatus = page.getByRole('button', { name: /Clear selection/i });
          if (await clearStatus.isVisible({ timeout: 2000 }).catch(() => false)) {
            await clearStatus.click();
          }

          // Wait until invoice card / View is available
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

          // Razorpay checkout iframe — UPI is default; select Netbanking via sidebar radio
          const razorpayFrame = page.frameLocator('iframe.razorpay-checkout-frame, iframe[src*="razorpay"]').first();
          await razorpayFrame.getByText(/Payment Options|Netbanking|UPI/i).first()
            .waitFor({ state: 'visible', timeout: 30000 });

          const netbankingRadio = razorpayFrame.getByRole('radio', { name: /Netbanking/i });
          await netbankingRadio.click({ force: true, timeout: 15000 });
          await razorpayFrame.getByText(/Suggested Banks|Search for Banks|Bank of Baroda/i).first()
            .waitFor({ state: 'visible', timeout: 15000 });

          const bankPopupPromise = context.waitForEvent('page', { timeout: 45000 }).catch(() => null);

          // Click a suggested bank button (avoid obscured radios in the method list)
          const bankBtn = razorpayFrame.getByRole('button', { name: /Bank of Baroda - Retail Banking/i }).first();
          await bankBtn.scrollIntoViewIfNeeded();
          await bankBtn.click({ force: true });

          const bankPage = await bankPopupPromise;
          if (bankPage) {
            await bankPage.waitForLoadState('domcontentloaded');
            await bankPage.getByRole('button', { name: 'Success' }).click();
            await bankPage.waitForEvent('close', { timeout: 30000 }).catch(() => {});
          } else {
            // Fallback: Success button on same page / another razorpay frame
            if (await page.getByRole('button', { name: 'Success' }).isVisible({ timeout: 8000 }).catch(() => false)) {
              await page.getByRole('button', { name: 'Success' }).click();
            } else {
              await razorpayFrame.getByRole('button', { name: 'Success' }).click({ timeout: 10000 });
            }
          }

          await page.bringToFront();
          await expect(page.getByText(/^PAID$/i).first()).toBeVisible({ timeout: 60000 });
      }

  if (!tenantPassword) {
    throw new Error('Cannot save shared tenant data — password is missing.');
  }

  saveSharedTenantData({
    fullName: data.fullName,
    email: data.email,
    mobile: data.mobile,
    propertyName: data.propertyName,
    password: tenantPassword,
    orgId: 'test240',
    moveInDate,
  });

  passwordCapture.dispose();
});
