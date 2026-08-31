import fs from 'fs';
import path from 'path';

export type SharedOrgData = {
  orgName: string;
  orgId: string;
  email: string;
  password: string;
  offices?: string;
  spaces?: string;
  savedAt: string;
};

/** Pre-provisioned existing org used by Flow1/Flow2-ExistingOrganization specs. */
export const EXISTING_ORG_ADMIN = {
  orgId: 'test',
  email: 'test@yopmail.com',
  password: 'Test2026$',
};

const DATA_DIR = path.join(process.cwd(), 'test-data');
const DATA_FILE = path.join(DATA_DIR, 'org.json');

export function saveSharedOrgData(
  data: Omit<SharedOrgData, 'savedAt'> & { savedAt?: string },
): string {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const payload: SharedOrgData = {
    ...data,
    savedAt: data.savedAt ?? new Date().toISOString(),
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`Shared org data saved to ${DATA_FILE}`);
  return DATA_FILE;
}

export function loadSharedOrgData(): SharedOrgData {
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error(
      `Shared org data not found at ${DATA_FILE}. Run tests/CreateOrganization.spec.ts first.`,
    );
  }
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  const data = JSON.parse(raw) as SharedOrgData;
  if (!data.orgId || !data.email || !data.password) {
    throw new Error(`Invalid shared org data in ${DATA_FILE} — orgId/email/password missing.`);
  }
  return data;
}

export function getSharedOrgDataPath(): string {
  return DATA_FILE;
}

const COUNTER_FILE = path.join(DATA_DIR, 'org-counter.json');

export type OrgCounterData = {
  lastNumber: number;
  savedAt: string;
};

export type SequentialOrgIdentity = {
  number: number;
  orgName: string;
  orgId: string;
  email: string;
};

function readLastOrgNumber(): number {
  if (!fs.existsSync(COUNTER_FILE)) return 0;
  try {
    const data = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf-8')) as OrgCounterData;
    if (typeof data.lastNumber === 'number' && Number.isFinite(data.lastNumber) && data.lastNumber >= 0) {
      return Math.floor(data.lastNumber);
    }
  } catch {
    // ignore corrupt file — start from 0
  }
  return 0;
}

function buildOrgIdentity(number: number): SequentialOrgIdentity {
  const slug = `auto${number}`;
  return {
    number,
    orgName: slug,
    orgId: slug,
    email: `propexceltest+${slug}@gmail.com`,
  };
}

/**
 * Peek next sequential org identity (auto1, auto2, …) WITHOUT advancing the counter.
 * Counter advances only via commitSequentialOrgIdentity after a successful create.
 * Override with: ORG_NUM=5 npx playwright test tests/CreateOrganization.spec.ts
 */
export function peekNextSequentialOrgIdentity(): SequentialOrgIdentity {
  const override = process.env.ORG_NUM?.trim();
  if (override && /^\d+$/.test(override)) {
    const number = Number(override);
    const identity = buildOrgIdentity(number);
    console.log(`Org identity from ORG_NUM env: ${identity.orgId}`);
    return identity;
  }

  const number = readLastOrgNumber() + 1;
  const identity = buildOrgIdentity(number);
  console.log(`Sequential org identity (peek): ${identity.orgId} — counter advances only on success`);
  return identity;
}

/** Persist last successful org number so the next run uses auto(N+1). */
export function commitSequentialOrgIdentity(number: number): void {
  if (!Number.isFinite(number) || number < 1) {
    throw new Error(`Invalid org sequence number to commit: ${number}`);
  }
  const payload: OrgCounterData = {
    lastNumber: Math.floor(number),
    savedAt: new Date().toISOString(),
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(COUNTER_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`Org counter committed: lastNumber=${payload.lastNumber} (next will be auto${payload.lastNumber + 1})`);
}

/** @deprecated use peekNextSequentialOrgIdentity — does not advance counter */
export function nextSequentialOrgIdentity(): SequentialOrgIdentity {
  return peekNextSequentialOrgIdentity();
}

/** Prefer org.json from CreateOrganization; fall back to existing org admin. */
export function getAdminLoginCredentials(): {
  orgId: string;
  email: string;
  password: string;
  orgName?: string;
  source: 'org.json' | 'fallback-existing-org';
} {
  if (fs.existsSync(DATA_FILE)) {
    const data = loadSharedOrgData();
    return {
      orgId: data.orgId,
      email: data.email,
      password: data.password,
      orgName: data.orgName,
      source: 'org.json',
    };
  }
  return {
    orgId: EXISTING_ORG_ADMIN.orgId,
    email: EXISTING_ORG_ADMIN.email,
    password: EXISTING_ORG_ADMIN.password,
    orgName: 'Super Admin',
    source: 'fallback-existing-org',
  };
}
