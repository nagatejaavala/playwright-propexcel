import type { BrowserContext, Page, Response } from '@playwright/test';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export type TenantCredentials = {
  password?: string;
  loginLink?: string;
};

const PASSWORD_JSON_KEYS = /"(?:temporaryPassword|tempPassword|temp_password|generatedPassword|plainPassword|tenantPassword)"\s*:\s*"([^"]{6,64})"/gi;

const TENANT_MAIL_SUBJECT = /Tenant Account Creat|Welcome to PropExcel|portal account|Tenant Portal/i;
const SKIP_MAIL_SUBJECT = /contract sent|move-in request|invoice/i;

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/gi, ' ');
}

function isValidPassword(password?: string): password is string {
  if (!password || password.length < 6 || password.length > 64 || /\s/.test(password)) {
    return false;
  }
  if (!/[A-Za-z0-9]/.test(password)) {
    return false;
  }
  if (/<\/?[a-z][a-z0-9]*[\s>\/]/i.test(password) || /&[a-z]+;/i.test(password)) {
    return false;
  }
  return true;
}

export function parsePasswordFromText(text: string): string | undefined {
  const patterns = [
    /Temporary Password\s*[:\n]\s*(\S{6,64})/i,
    /Temporary Password[^\n]*\n\s*(\S{6,64})/i,
    /(?:Temporary Password|Your password is|Password)\s*:\s*(\S{6,64})/i,
    /(?:Temporary Password|Your password is|Password)\s+(\S{6,64})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const password = decodeHtmlEntities(match[1].replace(/[.,;]+$/, '').trim());
      if (isValidPassword(password)) {
        return password;
      }
    }
  }

  return undefined;
}

export function parsePasswordFromJson(body: string): string | undefined {
  for (const match of body.matchAll(PASSWORD_JSON_KEYS)) {
    if (isValidPassword(match[1])) {
      return match[1];
    }
  }
  return undefined;
}

function isTenantUserResponse(url: string): boolean {
  return /tenant|create.*user|users\/create|portal-user|tenant-user/i.test(url);
}

export function createTenantPasswordCapture(page: Page) {
  let capturedPassword: string | undefined;

  const responseHandler = async (response: Response) => {
    if (capturedPassword || !response.url().includes('propexcel') || !isTenantUserResponse(response.url())) {
      return;
    }
    if (response.status() < 200 || response.status() >= 300) {
      return;
    }

    try {
      const json = await response.json();
      const password = parsePasswordFromJson(JSON.stringify(json));
      if (password) {
        capturedPassword = password;
        console.log('Tenant password captured from API response');
      }
    } catch {
      // Not JSON — ignore.
    }
  };

  page.on('response', responseHandler);

  return {
    getPassword: () => capturedPassword,
    setPassword: (password: string) => {
      capturedPassword = password;
    },
    dispose: () => {
      page.off('response', responseHandler);
    },
  };
}

export async function captureTenantPasswordFromDialog(page: Page): Promise<string | undefined> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const dialogs = page.getByRole('dialog');
    const count = await dialogs.count();

    for (let i = 0; i < count; i++) {
      const dialog = dialogs.nth(i);
      const text = (await dialog.textContent().catch(() => '')) ?? '';
      const password = parsePasswordFromText(text);
      if (password) {
        return password;
      }

      const codeEl = dialog.locator('code, pre, .font-mono, [class*="mono"], td').filter({ hasText: /\S{6,}/ });
      const codeCount = await codeEl.count();
      for (let j = 0; j < codeCount; j++) {
        const codeText = (await codeEl.nth(j).textContent() ?? '').trim();
        if (isValidPassword(codeText)) {
          return codeText;
        }
      }

      const passwordInput = dialog.locator('input[type="password"], input[readonly]').first();
      if (await passwordInput.isVisible({ timeout: 300 }).catch(() => false)) {
        const value = await passwordInput.inputValue().catch(() => '');
        if (isValidPassword(value)) {
          return value;
        }
      }
    }

    const toast = page.locator('[role="status"], [data-sonner-toast], .toast, [class*="toast"]');
    const toastCount = await toast.count();
    for (let i = 0; i < toastCount; i++) {
      const toastText = (await toast.nth(i).textContent().catch(() => '')) ?? '';
      const password = parsePasswordFromText(toastText);
      if (password) {
        return password;
      }
    }

    const pageText = await page.locator('body').innerText().catch(() => '');
    const pagePassword = parsePasswordFromText(pageText);
    if (pagePassword) {
      return pagePassword;
    }

    await page.waitForTimeout(500);
  }

  return undefined;
}

/** Click Create Tenant User confirm and poll API/dialog for the generated password. */
export async function confirmCreateTenantUserAndCapturePassword(
  page: Page,
  passwordCapture: ReturnType<typeof createTenantPasswordCapture>,
): Promise<string | undefined> {
  const existing = passwordCapture.getPassword();
  if (isValidPassword(existing)) {
    return existing;
  }

  const tenantDialog = page.getByRole('dialog').last();
  if (!(await tenantDialog.isVisible({ timeout: 8000 }).catch(() => false))) {
    return undefined;
  }

  const confirmBtn = tenantDialog.getByRole('button', { name: /Create|Confirm|Yes|Submit/i }).first();
  if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await confirmBtn.click();
  }

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const apiPassword = passwordCapture.getPassword();
    if (isValidPassword(apiPassword)) {
      console.log('Tenant password captured from API after Create Tenant User');
      return apiPassword;
    }

    const dialogPassword = await captureTenantPasswordFromDialog(page);
    if (isValidPassword(dialogPassword)) {
      console.log('Tenant password captured from dialog after Create Tenant User');
      passwordCapture.setPassword(dialogPassword);
      return dialogPassword;
    }

    await page.waitForTimeout(750);
  }

  return passwordCapture.getPassword();
}

function parsePasswordFromHtml(html: string): string | undefined {
  const patterns = [
    /Temporary Password[\s\S]*?<\/td>\s*<td[^>]*>\s*([^<\s]{6,64}|[^<\s]*(?:&(?:lt|gt|amp|quot|#\d+);[^<\s]*)+)\s*<\/td>/i,
    /Temporary Password[\s\S]*?<td[^>]*>\s*([^<\s]{6,64}|[^<\s]*(?:&(?:lt|gt|amp|quot|#\d+);[^<\s]*)+)\s*<\/td>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    const password = decodeHtmlEntities(match?.[1]?.replace(/[.,;]+$/, '').trim() ?? '');
    if (isValidPassword(password)) {
      return password;
    }
  }

  return undefined;
}

function isTenantWelcomeMail(body: string, html: string, tenantEmail: string): boolean {
  const combined = `${body}\n${html}`.toLowerCase();
  const emailLocal = tenantEmail.split('@')[0].toLowerCase();

  return (
    (combined.includes(tenantEmail.toLowerCase()) || combined.includes(emailLocal)) &&
    /tenant account|welcome to propexcel|portal account|your login credentials|temporary password|tenant portal/i.test(combined)
  );
}

function pickLoginLink(html: string, body: string): string | undefined {
  const hrefs = [...html.matchAll(/href="(https:\/\/[^"]+)"/gi)].map((match) => match[1]);
  const plain = `${body}\n${html}`.match(/https:\/\/[^\s"'<>]+/gi) ?? [];
  const candidates = [...hrefs, ...plain]
    .map((url) => url.replace(/[)\],.;]+$/, ''))
    .filter((url) => /propexcel|sendgrid/i.test(url))
    .filter((url) => !/\.(png|jpe?g|gif|svg|webp|css|js)(\?|$)/i.test(url));

  return (
    candidates.find((url) => /login|portal|auth|reset|password|invite|verify|token|tenant/i.test(url)) ??
    candidates.find((url) => /test\.propexcel\.com|demo\.propexcel/i.test(url)) ??
    candidates[0]
  );
}

function parseMailCredentials(body: string, html: string, tenantEmail: string): TenantCredentials | null {
  if (!isTenantWelcomeMail(body, html, tenantEmail)) {
    return null;
  }

  const password = parsePasswordFromText(body) ?? parsePasswordFromHtml(html);
  const credentials = {
    password,
    loginLink: pickLoginLink(html, body),
  };

  if (isValidPassword(credentials.password)) {
    return credentials;
  }

  if (credentials.loginLink) {
    return credentials;
  }

  return null;
}

async function readMailCredentialsFromText(
  body: string,
  html: string,
  tenantEmail: string,
): Promise<TenantCredentials | null> {
  const credentials = parseMailCredentials(body, html, tenantEmail);

  if (credentials?.password) {
    console.log(`Inbox: password parsed for ${tenantEmail}`);
  } else if (isTenantWelcomeMail(body, html, tenantEmail)) {
    console.log(`Inbox: tenant mail found for ${tenantEmail} but password not parsed yet`);
  }

  return credentials;
}

export const GMAIL_INBOX_EMAIL = 'propexceltest@gmail.com';
export const GMAIL_INBOX_PASSWORD = 'Test2026$';

function getGmailImapPassword(): string {
  const fromEnv = process.env.GMAIL_APP_PASSWORD?.trim().replace(/\s+/g, '');
  return fromEnv || GMAIL_INBOX_PASSWORD;
}

type GmailSession = {
  page: Page;
  loginPromise: Promise<void>;
};

const gmailSessionByContext = new WeakMap<BrowserContext, GmailSession>();

export async function getGmailInboxPage(context: BrowserContext, mainPage?: Page): Promise<Page> {
  let session = gmailSessionByContext.get(context);
  if (!session) {
    const gmailPage = await context.newPage();
    const loginPromise = loginToGmail(gmailPage)
      .then(async () => {
        if (mainPage) {
          await mainPage.bringToFront().catch(() => undefined);
        }
      })
      .catch((error) => {
        gmailSessionByContext.delete(context);
        throw error;
      });
    session = { page: gmailPage, loginPromise };
    gmailSessionByContext.set(context, session);
  }

  await session.loginPromise;
  if (mainPage) {
    await mainPage.bringToFront().catch(() => undefined);
  }
  return session.page;
}

async function fetchTenantMailFromImapOnce(tenantEmail: string): Promise<TenantCredentials | null> {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: GMAIL_INBOX_EMAIL,
      pass: getGmailImapPassword(),
    },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const uids = await client.search({ since }, { uid: true });
      const sorted = [...uids].sort((a, b) => b - a).slice(0, 40);

      for (const uid of sorted) {
        const message = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!message?.source) continue;

        const parsed = await simpleParser(message.source);
        const body = parsed.text ?? '';
        const html = typeof parsed.html === 'string' ? parsed.html : '';
        const subject = parsed.subject ?? '';

        if (SKIP_MAIL_SUBJECT.test(subject) && !TENANT_MAIL_SUBJECT.test(subject)) {
          continue;
        }

        const credentials = await readMailCredentialsFromText(body, html, tenantEmail);
        if (credentials) {
          return credentials;
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }

  return null;
}

/** Poll Gmail via IMAP (no browser login — avoids Google UI timeouts). */
export async function getTenantCredentialsFromImap(
  email: string,
  timeoutMs = 300_000,
): Promise<TenantCredentials> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const credentials = await fetchTenantMailFromImapOnce(email);
      if (credentials) {
        return credentials;
      }
    } catch (error) {
      const detail =
        error instanceof Error
          ? `${error.message}${(error as { responseText?: string }).responseText ? ` — ${(error as { responseText?: string }).responseText}` : ''}${(error as { response?: string }).response ? ` — ${(error as { response?: string }).response}` : ''}`
          : String(error);
      console.log(`IMAP poll error: ${detail}`);
    }

    console.log(`IMAP: no credentials yet for ${email}, retrying...`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error(`Tenant credentials email not found in Gmail IMAP for ${email}`);
}

async function waitForGmailInbox(page: Page, timeoutMs = 180_000): Promise<void> {
  const inboxSearch = page.getByRole('textbox', { name: /Search mail/i }).first();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (page.url().includes('mail.google.com') && !page.url().includes('accounts.google.com')) {
      if (await inboxSearch.isVisible({ timeout: 2000 }).catch(() => false)) {
        return;
      }
    }
    await page.waitForTimeout(2000);
  }

  await inboxSearch.waitFor({ state: 'visible', timeout: 5000 });
}

/**
 * When Google rejects automated login, keep the headed tab open so the user can
 * complete email + password + Next manually, then continue once inbox is ready.
 */
async function waitForManualGmailLogin(page: Page, reason: string): Promise<void> {
  console.log(`Gmail: ${reason}`);
  console.log(
    `Gmail: complete login manually in the browser tab — email ${GMAIL_INBOX_EMAIL} / password from GMAIL_INBOX_PASSWORD`,
  );
  await page.bringToFront().catch(() => undefined);

  if (!page.url().includes('accounts.google.com') && !page.url().includes('mail.google.com')) {
    await page.goto(
      'https://accounts.google.com/v3/signin/identifier?service=mail&continue=https://mail.google.com/mail/u/0/',
      { waitUntil: 'domcontentloaded' },
    );
  }

  await waitForGmailInbox(page, 180_000);
  console.log('Gmail: inbox ready after manual login');
}

/** Google account login via browser (email + password — no app password). */
export async function loginToGmail(page: Page) {
  await page.goto('https://mail.google.com/mail/u/0/#inbox', { waitUntil: 'domcontentloaded', timeout: 60000 });

  const inboxSearch = page.getByRole('textbox', { name: /Search mail/i }).first();
  if (page.url().includes('mail.google.com') && !page.url().includes('accounts.google.com')) {
    if (await inboxSearch.isVisible({ timeout: 10000 }).catch(() => false)) {
      console.log('Gmail: already signed in');
      return;
    }
  }

  const signInUrl =
    'https://accounts.google.com/v3/signin/identifier?service=mail&continue=https://mail.google.com/mail/u/0/&flowName=GlifWebSignIn';
  await page.goto(signInUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const useAnotherAccount = page.getByRole('link', { name: /Use another account/i });
  if (await useAnotherAccount.isVisible({ timeout: 3000 }).catch(() => false)) {
    await useAnotherAccount.click();
    await page.waitForLoadState('domcontentloaded');
  }

  const accountTile = page.locator(`[data-email="${GMAIL_INBOX_EMAIL}"]`).first();
  if (await accountTile.isVisible({ timeout: 3000 }).catch(() => false)) {
    await accountTile.click();
    await page.waitForLoadState('domcontentloaded');
  } else {
    const emailInput = page
      .locator('#identifierId')
      .or(page.getByRole('textbox', { name: /Email or phone/i }))
      .or(page.locator('input[type="email"], input[name="identifier"]'))
      .first();
    if (await emailInput.isVisible({ timeout: 15000 }).catch(() => false)) {
      await emailInput.click();
      await emailInput.fill('');
      await emailInput.pressSequentially(GMAIL_INBOX_EMAIL, { delay: 40 });
      await page.getByRole('button', { name: /^Next$/i }).click();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);
    }
  }

  if (/signin\/rejected|challenge|speedbump/i.test(page.url())) {
    await waitForManualGmailLogin(page, `Google blocked automated sign-in (${page.url()})`);
    return;
  }

  const passwordInput = page
    .locator('input[name="Passwd"]')
    .or(page.locator('input[type="password"][autocomplete="current-password"]'))
    .or(page.getByLabel(/^Enter your password$/i))
    .or(page.locator('input[type="password"]:not([aria-hidden="true"])'))
    .first();

  if (!(await passwordInput.isVisible({ timeout: 20000 }).catch(() => false))) {
    console.log(`Gmail: password field not visible yet — URL: ${page.url()}`);
    if (/signin\/rejected|challenge|speedbump/i.test(page.url())) {
      await waitForManualGmailLogin(page, `Google blocked automated sign-in (${page.url()})`);
      return;
    }
    await waitForManualGmailLogin(page, 'password field did not appear — waiting for manual login');
    return;
  }

  await passwordInput.click();
  await passwordInput.fill(GMAIL_INBOX_PASSWORD);
  await page.getByRole('button', { name: /^Next$/i }).click();
  await page.waitForLoadState('domcontentloaded');

  if (/signin\/rejected|challenge|speedbump/i.test(page.url())) {
    await waitForManualGmailLogin(page, `Google challenged login after password (${page.url()})`);
    return;
  }

  const continueBtn = page.getByRole('button', { name: /^Continue$/i });
  if (await continueBtn.isVisible({ timeout: 15000 }).catch(() => false)) {
    await continueBtn.click();
    await page.waitForLoadState('domcontentloaded');
  }
  const notNow = page.getByRole('button', { name: /Not now|Skip|No thanks/i });
  if (await notNow.isVisible({ timeout: 5000 }).catch(() => false)) {
    await notNow.click().catch(() => undefined);
  }

  if (!page.url().includes('mail.google.com')) {
    await page.goto('https://mail.google.com/mail/u/0/#inbox', { waitUntil: 'domcontentloaded' });
  }

  try {
    await inboxSearch.waitFor({ state: 'visible', timeout: 60000 });
    console.log('Gmail: logged in to inbox (browser)');
  } catch {
    await waitForManualGmailLogin(page, 'inbox not ready after automated login');
  }
}

async function openGmailSearch(page: Page, query: string) {
  const search = page.getByRole('textbox', { name: /Search mail/i })
    .or(page.locator('input[aria-label*="Search" i]'))
    .or(page.locator('form[role="search"] input'))
    .first();
  await search.waitFor({ state: 'visible', timeout: 30000 });
  await search.click();
  await search.fill('');
  await search.fill(query);
  await search.press('Enter');
  await page.waitForTimeout(2000);
}

async function clickGmailTenantMail(page: Page, tenantEmail: string): Promise<TenantCredentials | null> {
  const rows = page.locator('tr.zA, div[role="row"], table.F tr')
    .filter({ hasText: /PropExcel|Temporary Password|Tenant Account|Welcome/i });
  const count = await rows.count();
  const max = Math.min(count, 12);
  for (let i = 0; i < max; i++) {
    const row = rows.nth(i);
    const rowText = ((await row.textContent().catch(() => '')) || '').trim();
    if (SKIP_MAIL_SUBJECT.test(rowText) && !TENANT_MAIL_SUBJECT.test(rowText)) {
      continue;
    }
    console.log(`Gmail UI: opening mail "${rowText.slice(0, 80)}"`);
    await row.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(1500);

    const body = await page.locator('div.a3s, div[role="main"]').first().innerText().catch(() => '');
    const html = await page.content();
    const credentials = await readMailCredentialsFromText(body, html, tenantEmail);
    if (credentials) {
      return credentials;
    }

    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await page.waitForTimeout(1000);
  }
  return null;
}

async function pollGmailInboxForCredentials(
  page: Page,
  email: string,
  timeoutMs: number,
): Promise<TenantCredentials> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await openGmailSearch(page, `newer_than:1d (Temporary Password OR "Tenant Account" OR PropExcel) ${email}`);
    let credentials = await clickGmailTenantMail(page, email);
    if (credentials) {
      return credentials;
    }

    await openGmailSearch(page, 'newer_than:1d Temporary Password PropExcel');
    credentials = await clickGmailTenantMail(page, email);
    if (credentials) {
      return credentials;
    }

    console.log(`Gmail UI: no credentials yet for ${email}, refreshing inbox...`);
    await page.waitForTimeout(5000);
  }

  throw new Error(`Tenant credentials email not found in Gmail UI for ${email}`);
}

/** Browser Gmail UI poll — primary method for fetching tenant credentials. */
export async function getTenantCredentialsFromGmail(
  page: Page,
  email: string,
  timeoutMs = 300_000,
): Promise<TenantCredentials> {
  await loginToGmail(page);
  return pollGmailInboxForCredentials(page, email, timeoutMs);
}

/** @deprecated Use getTenantCredentialsFromGmail — kept for older imports. */
export async function getTenantCredentialsFromYopmail(
  page: Page,
  email: string,
  timeoutMs = 300_000,
): Promise<TenantCredentials> {
  return getTenantCredentialsFromGmail(page, email, timeoutMs);
}

/** Background poll via IMAP (no browser Google login). */
export function startGmailCredentialPolling(_context: BrowserContext, email: string, mainPage?: Page) {
  return (async () => {
    try {
      console.log('IMAP: starting background inbox poll...');
      return await getTenantCredentialsFromImap(email, 300_000);
    } catch (error) {
      console.log(`IMAP background polling failed: ${error instanceof Error ? error.message : error}`);
      throw error;
    } finally {
      if (mainPage) {
        await mainPage.bringToFront().catch(() => undefined);
      }
    }
  })();
}

/** @deprecated Use startGmailCredentialPolling — kept for older imports. */
export function startYopmailCredentialPolling(context: BrowserContext, email: string, mainPage?: Page) {
  return startGmailCredentialPolling(context, email, mainPage);
}

export async function resolveTenantCredentials(options: {
  capturedPassword?: string;
  gmailPromise?: Promise<TenantCredentials>;
  /** @deprecated alias for gmailPromise */
  yopmailPromise?: Promise<TenantCredentials>;
  page: Page;
  email: string;
  context?: BrowserContext;
}): Promise<TenantCredentials & { source: string }> {
  if (isValidPassword(options.capturedPassword)) {
    return { password: options.capturedPassword, source: 'capture' };
  }

  const mailPromise = options.gmailPromise ?? options.yopmailPromise;
  if (mailPromise) {
    const mailCredentials = await mailPromise.catch((error) => {
      console.log(`IMAP poll promise failed: ${error instanceof Error ? error.message : error}`);
      return null;
    });
    if (isValidPassword(mailCredentials?.password) || mailCredentials?.loginLink) {
      return { ...mailCredentials, source: 'imap' };
    }
  }

  try {
    console.log('Inbox: trying IMAP fetch...');
    const imapCredentials = await getTenantCredentialsFromImap(options.email, 180_000);
    if (isValidPassword(imapCredentials.password) || imapCredentials.loginLink) {
      return { ...imapCredentials, source: 'imap-fallback' };
    }
  } catch (error) {
    console.log(`IMAP fallback failed: ${error instanceof Error ? error.message : error}`);
  }

  if (options.context) {
    try {
      console.log('Inbox: trying Gmail UI fallback...');
      const gmailPage = await getGmailInboxPage(options.context, options.page);
      const uiCredentials = await pollGmailInboxForCredentials(gmailPage, options.email, 120_000);
      return { ...uiCredentials, source: 'gmail-ui-fallback' };
    } catch (error) {
      console.log(`Gmail UI fallback failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  throw new Error(`Could not resolve tenant credentials for ${options.email}`);
}
