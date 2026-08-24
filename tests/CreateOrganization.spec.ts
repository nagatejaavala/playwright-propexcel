import { test, expect, Page } from '@playwright/test';
import { saveSharedOrgData } from '../utils/SharedOrgData';

function randomThreeDigits() {
  return String(Math.floor(100 + Math.random() * 900));
}

function randomCount() {
  return String(10 + Math.floor(Math.random() * 41)); // 10–50
}

function randomFutureExpiry() {
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const year = String((new Date().getFullYear() + 1 + Math.floor(Math.random() * 4)) % 100).padStart(2, '0');
  return { month, year, combined: `${month}${year}` };
}

async function fillInAnyFrame(page: Page, selectors: string[], value: string): Promise<boolean> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      for (const sel of selectors) {
        const input = frame.locator(sel).first();
        if (await input.isVisible({ timeout: 300 }).catch(() => false)) {
          await input.click({ force: true }).catch(() => undefined);
          await input.fill('');
          await input.fill(value);
          return true;
        }
      }
    }
    await page.waitForTimeout(500);
  }
  return false;
}

async function findComplete3DSButton(page: Page) {
  const pages = page.context().pages();
  for (const p of pages) {
    for (const frame of p.frames()) {
      const btn = frame.getByRole('button', { name: /^(COMPLETE|Complete)$/i }).first();
      if (await btn.isVisible({ timeout: 250 }).catch(() => false)) {
        return btn;
      }
    }
    const pageBtn = p.getByRole('button', { name: /^(COMPLETE|Complete)$/i }).first();
    if (await pageBtn.isVisible({ timeout: 250 }).catch(() => false)) {
      return pageBtn;
    }
  }
  return null;
}

async function is3DSChallengeVisible(page: Page): Promise<boolean> {
  for (const p of page.context().pages()) {
    for (const frame of p.frames()) {
      if (await frame.getByRole('heading', { name: /3D Secure/i }).isVisible({ timeout: 200 }).catch(() => false)) {
        return true;
      }
      if (await frame.getByRole('button', { name: /^(COMPLETE|Complete)$/i }).isVisible({ timeout: 200 }).catch(() => false)) {
        return true;
      }
    }
  }
  return false;
}

/** Click Stripe 3DS COMPLETE and wait until the challenge closes (retry if needed). */
async function clickComplete3DS(page: Page): Promise<void> {
  const deadline = Date.now() + 90000;
  let clickedOnce = false;

  while (Date.now() < deadline) {
    const btn = await findComplete3DSButton(page);
    if (btn) {
      await btn.click({ force: true }).catch(async () => {
        await btn.evaluate((el) => (el as HTMLElement).click());
      });
      clickedOnce = true;
      console.log('3D Secure COMPLETE clicked');

      await page.waitForTimeout(2500);
      if (!(await is3DSChallengeVisible(page))) {
        console.log('3D Secure challenge closed');
        return;
      }
      console.log('3D Secure still visible — retrying COMPLETE');
      continue;
    }

    // No button right now — if challenge already gone after a prior click, success
    if (clickedOnce && !(await is3DSChallengeVisible(page))) {
      console.log('3D Secure challenge closed');
      return;
    }

    await page.waitForTimeout(1000);
  }

  if (!clickedOnce) {
    throw new Error('3D Secure COMPLETE button not found');
  }
  throw new Error('3D Secure COMPLETE clicked but challenge did not close');
}

/** After Stripe payment, wait until PropExcel login is ready (retry 3DS if it reappears). */
async function waitForLoginAfterStripe(page: Page): Promise<void> {
  const deadline = Date.now() + 180000;
  const welcome = page.getByRole('heading', { name: /Welcome Back/i });

  while (Date.now() < deadline) {
    if (
      page.url().includes('test.propexcel.com') &&
      page.url().includes('/login') &&
      (await welcome.isVisible({ timeout: 500 }).catch(() => false))
    ) {
      return;
    }

    if (await welcome.isVisible({ timeout: 500 }).catch(() => false)) {
      return;
    }

    // Stripe sometimes re-shows 3DS or click didn't stick
    if (await is3DSChallengeVisible(page)) {
      const btn = await findComplete3DSButton(page);
      if (btn) {
        await btn.click({ force: true }).catch(async () => {
          await btn.evaluate((el) => (el as HTMLElement).click());
        });
        console.log('3D Secure COMPLETE re-clicked while waiting for login');
        await page.waitForTimeout(2000);
      }
    }

    await page.waitForTimeout(1000);
  }

  throw new Error('Timed out waiting for login page after Stripe 3DS / Subscribe');
}

/**
 * Create Organization — register a new org, pay Stripe verification, land on login.
 * Saves login credentials to test-data/org.json for later use.
 *
 * Run:
 *   npx playwright test tests/CreateOrganization.spec.ts --headed
 */
test('Create Organization — register new org and save login data', async ({ page }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(30_000);

  const suffix = randomThreeDigits();
  const orgName = `Automation ${suffix}`;
  // Organization ID used at login — stable slug without spaces
  const orgId = `automation-${suffix}`;
  const adminEmail = `${orgName.replace(/\s+/g, '').toLowerCase()}@yopmail.com`;
  const password = 'Test2026$';
  const offices = randomCount();
  const spaces = randomCount();
  const expiry = randomFutureExpiry();
  const cvc = randomThreeDigits();

  console.log('Create Organization data:', { orgName, orgId, adminEmail, offices, spaces });

  // 1) Open login URL
  await page.goto('https://test.propexcel.com/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: /Welcome Back/i }).waitFor({ timeout: 30000 });

  // 2) Create a new organization
  await page.getByRole('button', { name: /Create a new organization/i }).click();
  await page.getByRole('heading', { name: /Create Account/i }).waitFor({ timeout: 15000 });

  // 3–6) Details step
  await page.getByPlaceholder(/Acme Properties/i).fill(orgName);

  // Ensure Organization Code matches what we save for login
  const orgCodeField = page.getByPlaceholder(/acme-properties/i)
    .or(page.getByLabel(/Organization Code/i));
  if (await orgCodeField.first().isVisible({ timeout: 3000 }).catch(() => false)) {
    await orgCodeField.first().fill('');
    await orgCodeField.first().fill(orgId);
  }

  await page.getByPlaceholder(/admin@company.com/i).fill(adminEmail);
  await page.getByPlaceholder(/Min\. 8 characters/i).fill(password);
  await page.getByPlaceholder(/Enter referral code/i).fill('TEST9');

  // 7) Continue
  await page.getByRole('button', { name: /^Continue$/i }).click();
  await page.getByText(/Customize your workspace settings/i).waitFor({ timeout: 15000 });

  // 8) Offices and spaces (10–50)
  const officesField = page.getByLabel(/Number of Offices/i)
    .or(page.getByRole('spinbutton').first())
    .or(page.locator('input[type="number"]').first());
  const spacesField = page.getByLabel(/Number of Coworking Spaces/i)
    .or(page.getByRole('spinbutton').nth(1))
    .or(page.locator('input[type="number"]').nth(1));
  await officesField.first().fill(offices);
  await spacesField.first().fill(spaces);

  // 9) Terms checkbox
  const terms = page.getByRole('checkbox', { name: /I agree to the Terms and Conditions/i })
    .or(page.getByRole('checkbox').first());
  await terms.first().check();

  // 10) Proceed to Register
  await page.getByRole('button', { name: /Proceed to Register/i }).click();
  console.log('Proceeded to Register:', { orgName, orgId, adminEmail, offices, spaces });

  // 11–13) Stripe Checkout — card details
  await page.getByRole('button', { name: /^Subscribe$/i }).waitFor({ state: 'visible', timeout: 90000 });

  const cardFilled = await fillInAnyFrame(
    page,
    [
      'input[name="cardnumber"]',
      'input[autocomplete="cc-number"]',
      'input[placeholder*="1234"]',
      'input[data-elements-stable-field-name="cardNumber"]',
    ],
    '4000003560000123',
  );
  if (!cardFilled) {
    throw new Error('Stripe card number field not found');
  }

  const expiryFilled = await fillInAnyFrame(
    page,
    [
      'input[name="exp-date"]',
      'input[autocomplete="cc-exp"]',
      'input[placeholder*="MM"]',
      'input[data-elements-stable-field-name="cardExpiry"]',
    ],
    expiry.combined,
  );
  if (!expiryFilled) {
    throw new Error('Stripe expiry field not found');
  }

  const cvcFilled = await fillInAnyFrame(
    page,
    [
      'input[name="cvc"]',
      'input[autocomplete="cc-csc"]',
      'input[placeholder*="CVC" i]',
      'input[data-elements-stable-field-name="cardCvc"]',
    ],
    cvc,
  );
  if (!cvcFilled) {
    throw new Error('Stripe CVC field not found');
  }

  const nameField = page.getByPlaceholder(/Full name on card/i)
    .or(page.getByLabel(/Cardholder name|Name on card/i));
  await nameField.first().waitFor({ state: 'visible', timeout: 15000 });
  await nameField.first().fill(orgName);

  console.log('Stripe card filled:', {
    card: '4000003560000123',
    expiry: `${expiry.month}/${expiry.year}`,
    cvc,
    cardholder: orgName,
  });

  await page.getByRole('button', { name: /^Subscribe$/i }).click();

  // 14) 3D Secure → COMPLETE (retry until challenge closes)
  await clickComplete3DS(page);

  // Wait until PropExcel login appears (re-click 3DS if it comes back)
  await waitForLoginAfterStripe(page);
  await expect(page.getByRole('heading', { name: /Welcome Back/i })).toBeVisible({ timeout: 30000 });
  console.log('Returned to login page after organization registration');

  // Save login credentials for later flows
  saveSharedOrgData({
    orgName,
    orgId,
    email: adminEmail,
    password,
    offices,
    spaces,
  });
});
