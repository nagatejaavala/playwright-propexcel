import fs from 'fs';
import path from 'path';

export type SequentialTenantIdentity = {
  number: number;
  fullName: string;
  email: string;
  mobile: string;
};

const DATA_DIR = path.join(process.cwd(), 'test-data');
const COUNTER_FILE = path.join(DATA_DIR, 'tenant-counter.json');

export type TenantCounterData = {
  lastNumber: number;
  savedAt: string;
};

/** 10-digit Indian mobile starting with 6, 7, 8, or 9. */
export function generateIndianMobile(): string {
  const firstDigit = [6, 7, 8, 9][Math.floor(Math.random() * 4)];
  const rest = String(Math.floor(100000000 + Math.random() * 900000000));
  return `${firstDigit}${rest}`;
}

function readLastTenantNumber(): number {
  if (!fs.existsSync(COUNTER_FILE)) return 0;
  try {
    const data = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf-8')) as TenantCounterData;
    if (typeof data.lastNumber === 'number' && Number.isFinite(data.lastNumber) && data.lastNumber >= 0) {
      return Math.floor(data.lastNumber);
    }
  } catch {
    // ignore corrupt file
  }
  return 0;
}

function buildTenantIdentity(number: number): SequentialTenantIdentity {
  const slug = `tenant${number}`;
  return {
    number,
    fullName: slug,
    email: `propexceltest+${slug}@gmail.com`,
    mobile: generateIndianMobile(),
  };
}

/** Build tenant{N} identity for a specific sequence number (contact retry / TENANT_NUM). */
export function buildTenantIdentityAt(number: number): SequentialTenantIdentity {
  return buildTenantIdentity(number);
}

/**
 * Peek next sequential tenant (tenant1, tenant2, …) WITHOUT advancing the counter.
 * Override: TENANT_NUM=5 npx playwright test ...
 */
export function peekNextSequentialTenantIdentity(): SequentialTenantIdentity {
  const override = process.env.TENANT_NUM?.trim();
  if (override && /^\d+$/.test(override)) {
    const number = Number(override);
    const identity = buildTenantIdentity(number);
    console.log(`Tenant identity from TENANT_NUM env: ${identity.fullName}`);
    return identity;
  }

  const number = readLastTenantNumber() + 1;
  const identity = buildTenantIdentity(number);
  console.log(`Sequential tenant identity (peek): ${identity.fullName} — counter advances only on success`);
  return identity;
}

const EXISTING_ORG_TENANT_FILE = path.join(DATA_DIR, 'tenant.json');
const NEW_ORG_TENANT_FILE = path.join(DATA_DIR, 'tenant-new-org.json');

function readNewOrgTenantBaseline(): number {
  let lastUsed = readLastTenantNumber();
  if (fs.existsSync(NEW_ORG_TENANT_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(NEW_ORG_TENANT_FILE, 'utf-8')) as { fullName?: string };
      const match = String(saved.fullName || '').match(/^tenant(\d+)$/i);
      if (match) {
        lastUsed = Math.max(lastUsed, Number(match[1]));
      }
    } catch {
      // ignore corrupt tenant-new-org.json
    }
  }
  return lastUsed;
}

/**
 * Peek next tenant for new-org Flow1 — uses max(tenant-counter, tenant-new-org.json, crmHighest) + 1.
 */
export function peekNextNewOrgTenantIdentity(crmHighest = 0): SequentialTenantIdentity {
  const override = process.env.TENANT_NUM?.trim();
  if (override && /^\d+$/.test(override)) {
    const number = Number(override);
    const identity = buildTenantIdentity(number);
    console.log(`New org tenant from TENANT_NUM env: ${identity.fullName}`);
    return identity;
  }

  const lastUsed = Math.max(readNewOrgTenantBaseline(), Math.floor(crmHighest));
  const number = lastUsed + 1;
  const identity = buildTenantIdentity(number);
  console.log(
    `New org tenant identity (peek): ${identity.fullName} (local last: tenant${readNewOrgTenantBaseline()}, crm highest: tenant${crmHighest})`,
  );
  return identity;
}

function readExistingOrgTenantBaseline(): number {
  let lastUsed = readLastTenantNumber();
  if (fs.existsSync(EXISTING_ORG_TENANT_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(EXISTING_ORG_TENANT_FILE, 'utf-8')) as { fullName?: string };
      const match = String(saved.fullName || '').match(/^tenant(\d+)$/i);
      if (match) {
        lastUsed = Math.max(lastUsed, Number(match[1]));
      }
    } catch {
      // ignore corrupt tenant.json
    }
  }
  return lastUsed;
}

/**
 * Peek next tenant for existing-org Flow1 — uses max(tenant-counter, tenant.json, crmHighest) + 1.
 * Pass crmHighest from a CRM scan so reruns skip contacts that already exist in PropExcel.
 */
export function peekNextExistingOrgTenantIdentity(crmHighest = 0): SequentialTenantIdentity {
  const override = process.env.TENANT_NUM?.trim();
  if (override && /^\d+$/.test(override)) {
    const number = Number(override);
    const identity = buildTenantIdentity(number);
    console.log(`Existing org tenant from TENANT_NUM env: ${identity.fullName}`);
    return identity;
  }

  const lastUsed = Math.max(readExistingOrgTenantBaseline(), Math.floor(crmHighest));
  const number = lastUsed + 1;
  const identity = buildTenantIdentity(number);
  console.log(
    `Existing org tenant identity (peek): ${identity.fullName} (local last: tenant${readExistingOrgTenantBaseline()}, crm highest: tenant${crmHighest})`,
  );
  return identity;
}

/** Persist last successful tenant number so the next run uses tenant(N+1). */
export function commitSequentialTenantIdentity(number: number): void {
  if (!Number.isFinite(number) || number < 1) {
    throw new Error(`Invalid tenant sequence number to commit: ${number}`);
  }
  const payload: TenantCounterData = {
    lastNumber: Math.floor(number),
    savedAt: new Date().toISOString(),
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(COUNTER_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`Tenant counter committed: lastNumber=${payload.lastNumber} (next will be tenant${payload.lastNumber + 1})`);
}

/** Normalize to 10-digit Indian mobile (starts with 6–9). */
export function normalizeIndianMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  const ten = digits.length >= 10 ? digits.slice(-10) : digits;
  if (ten.length !== 10 || !/^[6-9]/.test(ten)) {
    return generateIndianMobile();
  }
  return ten;
}

/** E.164-style value accepted by PropExcel phone input after India is selected. */
export function formatIndianMobileE164(mobile: string): string {
  return `+91${normalizeIndianMobile(mobile)}`;
}

/** Fill India (+91) country and mobile on Create Contact dialog. */
export async function fillIndiaPhoneInContactDialog(
  dialog: import('@playwright/test').Locator,
  mobile: string,
) {
  const countryCombo = dialog.getByRole('combobox', { name: 'Phone number country' });
  const mobileField = dialog.getByRole('textbox', { name: 'Enter mobile number' });

  await countryCombo.selectOption({ label: 'India' });
  await mobileField.fill('');
  await mobileField.fill(formatIndianMobileE164(mobile));
}

/** Fill mobile on lead forms (India +91 full number). */
export async function fillIndiaPhoneInLeadForm(
  leadForm: import('@playwright/test').Locator,
  mobile: string,
) {
  const mobileField = leadForm.getByRole('textbox', { name: '+1234567890' })
    .or(leadForm.getByPlaceholder('+1234567890'))
    .first();
  await mobileField.fill(formatIndianMobileE164(mobile));
}
