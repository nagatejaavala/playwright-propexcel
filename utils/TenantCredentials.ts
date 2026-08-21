import type { BrowserContext, Page, Response } from '@playwright/test';

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
  // Reject HTML leftovers, but allow special chars like < > & in real passwords
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

    const pageText = await page.locator('body').innerText().catch(() => '');
    const pagePassword = parsePasswordFromText(pageText);
    if (pagePassword) {
      return pagePassword;
    }

    await page.waitForTimeout(500);
  }

  return undefined;
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

function parseMailCredentials(body: string, html: string, tenantEmail: string): TenantCredentials | null {
  if (!isTenantWelcomeMail(body, html, tenantEmail)) {
    return null;
  }

  const password = parsePasswordFromText(body) ?? parsePasswordFromHtml(html);
  const linkMatch =
    html.match(/href="(https:\/\/[^"]*(?:propexcel|sendgrid)[^"]*)"/i) ??
    `${body}\n${html}`.match(/https:\/\/[^\s"'<>]*(?:propexcel|sendgrid)[^\s"'<>]*/i);

  const credentials = {
    password,
    loginLink: linkMatch?.[1] ?? linkMatch?.[0],
  };

  if (isValidPassword(credentials.password)) {
    return credentials;
  }

  if (credentials.loginLink) {
    return credentials;
  }

  return null;
}

async function readMailCredentials(page: Page, tenantEmail: string): Promise<TenantCredentials | null> {
  const mailFrame = page.frameLocator('#ifmail');
  if (!await mailFrame.locator('body').isVisible({ timeout: 8000 }).catch(() => false)) {
    return null;
  }

  await mailFrame.locator('text=/Temporary Password|Welcome,/i').first()
    .waitFor({ state: 'visible', timeout: 8000 })
    .catch(() => {});

  const body = await mailFrame.locator('body').innerText().catch(() => '');
  const html = await mailFrame.locator('body').innerHTML().catch(() => '');
  const credentials = parseMailCredentials(body, html, tenantEmail);

  if (credentials?.password) {
    console.log(`YOPmail: password parsed for ${tenantEmail}`);
  } else if (isTenantWelcomeMail(body, html, tenantEmail)) {
    console.log(`YOPmail: tenant mail opened for ${tenantEmail} but password not parsed yet`);
  }

  return credentials;
}

async function handleYopmailCaptcha(page: Page) {
  const captcha = page.getByText(/Complete the CAPTCHA|I'm not a robot/i);
  if (!await captcha.isVisible({ timeout: 1500 }).catch(() => false)) {
    return;
  }

  console.log('YOPmail CAPTCHA detected — complete it in the browser, then click Resume.');
  await page.pause();

  try {
    await captcha.waitFor({ state: 'hidden', timeout: 180_000 });
  } catch {
    throw new Error('YOPmail CAPTCHA was not completed.');
  }
}

async function openYopmailInbox(page: Page, inboxUrl: string, reload: boolean) {
  if (reload) {
    await page.goto(inboxUrl, { waitUntil: 'domcontentloaded' });
  } else {
    await page.locator('#refresh').click({ timeout: 3000 }).catch(async () => {
      await page.goto(inboxUrl, { waitUntil: 'domcontentloaded' });
    });
  }

  await page.locator('#ifinbox').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
  await handleYopmailCaptcha(page);
  await page.waitForTimeout(reload ? 1500 : 2500);
}

async function tryReadOpenMail(page: Page, tenantEmail: string): Promise<TenantCredentials | null> {
  return readMailCredentials(page, tenantEmail);
}

async function clickTenantMail(page: Page, tenantEmail: string): Promise<TenantCredentials | null> {
  const inboxFrame = page.frameLocator('#ifinbox');

  const tenantEmails = inboxFrame.locator('.m, .lm, button').filter({ hasText: TENANT_MAIL_SUBJECT });
  const tenantCount = await tenantEmails.count();

  for (let i = 0; i < tenantCount; i++) {
    const row = tenantEmails.nth(i);
    const rowText = (await row.textContent().catch(() => '')) ?? '';
    console.log(`YOPmail: opening tenant mail "${rowText.trim().slice(0, 80)}"`);
    await row.click().catch(() => {});
    await handleYopmailCaptcha(page);
    await page.waitForTimeout(1500);

    const credentials = await readMailCredentials(page, tenantEmail);
    if (credentials) {
      return credentials;
    }
  }

  const propexcelEmails = inboxFrame.locator('.m, .lm, button').filter({ hasText: /noreply@propexcel\.com/i });
  const propexcelCount = await propexcelEmails.count();

  for (let i = 0; i < propexcelCount; i++) {
    const row = propexcelEmails.nth(i);
    const rowText = (await row.textContent().catch(() => '')) ?? '';
    if (SKIP_MAIL_SUBJECT.test(rowText) && !TENANT_MAIL_SUBJECT.test(rowText)) {
      continue;
    }
    console.log(`YOPmail: opening propexcel mail "${rowText.trim().slice(0, 80)}"`);
    await row.click().catch(() => {});
    await handleYopmailCaptcha(page);
    await page.waitForTimeout(1500);

    const credentials = await readMailCredentials(page, tenantEmail);
    if (credentials) {
      return credentials;
    }
  }

  return null;
}

export async function getTenantCredentialsFromYopmail(
  page: Page,
  email: string,
  timeoutMs = 300_000,
): Promise<TenantCredentials> {
  const yopmailUser = email.split('@')[0];
  const inboxUrl = `https://yopmail.com/en/?login=${yopmailUser}`;
  const deadline = Date.now() + timeoutMs;
  let inboxLoaded = false;

  while (Date.now() < deadline) {
    await openYopmailInbox(page, inboxUrl, !inboxLoaded);
    inboxLoaded = true;

    const openMailCredentials = await tryReadOpenMail(page, email);
    if (openMailCredentials) {
      return openMailCredentials;
    }

    const clickedCredentials = await clickTenantMail(page, email);
    if (clickedCredentials) {
      return clickedCredentials;
    }

    console.log(`YOPmail: no credentials yet for ${email}, refreshing inbox...`);
    await page.waitForTimeout(4000);
  }

  throw new Error(`Tenant credentials email not found in YOPmail for ${email}`);
}

export function startYopmailCredentialPolling(context: BrowserContext, email: string, mainPage?: Page) {
  return context.newPage().then(async (yopmailPage) => {
    try {
      if (mainPage) {
        await mainPage.bringToFront();
      }
      return await getTenantCredentialsFromYopmail(yopmailPage, email, 300_000);
    } catch (error) {
      console.log(`YOPmail background polling failed: ${error instanceof Error ? error.message : error}`);
      throw error;
    } finally {
      await yopmailPage.close().catch(() => {});
      if (mainPage) {
        await mainPage.bringToFront();
      }
    }
  });
}

export async function resolveTenantCredentials(options: {
  capturedPassword?: string;
  yopmailPromise?: Promise<TenantCredentials>;
  page: Page;
  email: string;
  context?: BrowserContext;
}): Promise<TenantCredentials & { source: string }> {
  if (isValidPassword(options.capturedPassword)) {
    return { password: options.capturedPassword, source: 'capture' };
  }

  if (options.yopmailPromise) {
    const yopmailCredentials = await options.yopmailPromise.catch(() => null);
    if (isValidPassword(yopmailCredentials?.password) || yopmailCredentials?.loginLink) {
      return { ...yopmailCredentials, source: 'yopmail' };
    }
  }

  const fallbackPage = options.context
    ? await options.context.newPage()
    : options.page;

  try {
    await options.page.bringToFront();
    console.log('YOPmail: trying fallback inbox tab...');
    const fallback = await getTenantCredentialsFromYopmail(fallbackPage, options.email, 180_000);
    return { ...fallback, source: 'yopmail-fallback' };
  } finally {
    if (options.context && fallbackPage !== options.page) {
      await fallbackPage.close().catch(() => {});
      await options.page.bringToFront();
    }
  }
}
