import fs from 'fs';
import path from 'path';

export type SharedTenantData = {
  fullName: string;
  /** Company contact display name — used for invoice Billed To as "{companyName} (Tenant)". */
  companyName?: string;
  email: string;
  mobile: string;
  propertyName: string;
  password: string;
  orgId: string;
  moveInDate?: string;
  savedAt: string;
};

const DATA_DIR = path.join(process.cwd(), 'test-data');
const DATA_FILE = path.join(DATA_DIR, 'tenant.json');

export function saveSharedTenantData(
  data: Omit<SharedTenantData, 'savedAt'> & { savedAt?: string },
): string {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const payload: SharedTenantData = {
    ...data,
    savedAt: data.savedAt ?? new Date().toISOString(),
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`Shared tenant data saved to ${DATA_FILE}`);
  return DATA_FILE;
}

export function loadSharedTenantData(): SharedTenantData {
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error(
      `Shared tenant data not found at ${DATA_FILE}. Run Flow 1 (tests/Flow1-ExistingOrganization.spec.ts) first.`,
    );
  }
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  const data = JSON.parse(raw) as SharedTenantData;
  if (!data.email || !data.password) {
    throw new Error(`Invalid shared tenant data in ${DATA_FILE} — email/password missing.`);
  }
  return data;
}

export function getSharedTenantDataPath(): string {
  return DATA_FILE;
}

/** Separate tenant store for Flow1/Flow2 New Organization (does not overwrite tenant.json). */
const NEW_ORG_DATA_FILE = path.join(DATA_DIR, 'tenant-new-org.json');

export function saveSharedTenantDataNewOrg(
  data: Omit<SharedTenantData, 'savedAt'> & { savedAt?: string },
): string {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const payload: SharedTenantData = {
    ...data,
    savedAt: data.savedAt ?? new Date().toISOString(),
  };
  fs.writeFileSync(NEW_ORG_DATA_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`Shared new-org tenant data saved to ${NEW_ORG_DATA_FILE}`);
  return NEW_ORG_DATA_FILE;
}

export function loadSharedTenantDataNewOrg(): SharedTenantData {
  if (!fs.existsSync(NEW_ORG_DATA_FILE)) {
    throw new Error(
      `Shared new-org tenant data not found at ${NEW_ORG_DATA_FILE}. ` +
        `Run Flow1-NewOrganization.spec.ts first.`,
    );
  }
  const raw = fs.readFileSync(NEW_ORG_DATA_FILE, 'utf-8');
  const data = JSON.parse(raw) as SharedTenantData;
  if (!data.email || !data.password || !data.orgId) {
    throw new Error(
      `Invalid shared new-org tenant data in ${NEW_ORG_DATA_FILE} — email/password/orgId missing.`,
    );
  }
  return data;
}

export function getSharedTenantDataNewOrgPath(): string {
  return NEW_ORG_DATA_FILE;
}

/** Company-category Flow1/Flow2 new-org tenant store. */
const NEW_ORG_COMPANY_DATA_FILE = path.join(DATA_DIR, 'tenant-new-org-company.json');

export function saveSharedTenantDataNewOrgCompany(
  data: Omit<SharedTenantData, 'savedAt'> & { savedAt?: string },
): string {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const payload: SharedTenantData = {
    ...data,
    savedAt: data.savedAt ?? new Date().toISOString(),
  };
  fs.writeFileSync(NEW_ORG_COMPANY_DATA_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`Shared company new-org tenant data saved to ${NEW_ORG_COMPANY_DATA_FILE}`);
  return NEW_ORG_COMPANY_DATA_FILE;
}

export function loadSharedTenantDataNewOrgCompany(): SharedTenantData {
  if (!fs.existsSync(NEW_ORG_COMPANY_DATA_FILE)) {
    throw new Error(
      `Shared company new-org tenant data not found at ${NEW_ORG_COMPANY_DATA_FILE}. ` +
        `Run Company category Scenario Flow1-NewOrganization.spec.ts first.`,
    );
  }
  const raw = fs.readFileSync(NEW_ORG_COMPANY_DATA_FILE, 'utf-8');
  const data = JSON.parse(raw) as SharedTenantData;
  if (!data.email || !data.password || !data.orgId) {
    throw new Error(
      `Invalid company new-org tenant data in ${NEW_ORG_COMPANY_DATA_FILE} — email/password/orgId missing.`,
    );
  }
  return data;
}

export function getSharedTenantDataNewOrgCompanyPath(): string {
  return NEW_ORG_COMPANY_DATA_FILE;
}
