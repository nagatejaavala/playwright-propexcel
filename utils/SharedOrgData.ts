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

/** Prefer org.json from CreateOrganization; fall back to test240 for legacy runs. */
export function getAdminLoginCredentials(): {
  orgId: string;
  email: string;
  password: string;
  orgName?: string;
  source: 'org.json' | 'fallback-test240';
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
    orgId: 'test240',
    email: 'test240@yopmail.com',
    password: 'Test2026$',
    orgName: 'Super Admin',
    source: 'fallback-test240',
  };
}
