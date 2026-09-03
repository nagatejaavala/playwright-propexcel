import fs from 'fs';
import path from 'path';

export type SharedCrmPerson = {
  fullName: string;
  /** Present for Company-type contacts; invoice Billed To uses "{companyName} (Tenant)". */
  companyName?: string;
  email: string;
  mobile: string;
};

export type SharedCrmData = {
  orgId: string;
  orgName?: string;
  contacts: SharedCrmPerson[];
  leads: SharedCrmPerson[];
  savedAt: string;
};

const DATA_DIR = path.join(process.cwd(), 'test-data');
const DATA_FILE = path.join(DATA_DIR, 'crm-contacts-leads.json');

export function saveSharedCrmData(
  data: Omit<SharedCrmData, 'savedAt'> & { savedAt?: string },
): string {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const payload: SharedCrmData = {
    ...data,
    contacts: data.contacts ?? [],
    leads: data.leads ?? [],
    savedAt: data.savedAt ?? new Date().toISOString(),
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`Shared CRM contacts/leads saved to ${DATA_FILE}`);
  return DATA_FILE;
}

export function loadSharedCrmData(): SharedCrmData {
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error(
      `Shared CRM data not found at ${DATA_FILE}. ` +
        `Run tests/Creating Contacts,Leads,Deals.spec.ts first.`,
    );
  }
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  const data = JSON.parse(raw) as SharedCrmData;
  if (!Array.isArray(data.contacts) || !Array.isArray(data.leads)) {
    throw new Error(`Invalid shared CRM data in ${DATA_FILE} — contacts/leads arrays missing.`);
  }
  if (data.contacts.length === 0 && data.leads.length === 0) {
    throw new Error(`Invalid shared CRM data in ${DATA_FILE} — contacts and leads are empty.`);
  }
  return data;
}

export function getSharedCrmDataPath(): string {
  return DATA_FILE;
}

/** Company-category scenario CRM store (does not overwrite Individual crm-contacts-leads.json). */
const COMPANY_DATA_FILE = path.join(DATA_DIR, 'crm-contacts-leads-company.json');

export function saveSharedCrmDataCompany(
  data: Omit<SharedCrmData, 'savedAt'> & { savedAt?: string },
): string {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const payload: SharedCrmData = {
    ...data,
    contacts: data.contacts ?? [],
    leads: data.leads ?? [],
    savedAt: data.savedAt ?? new Date().toISOString(),
  };
  fs.writeFileSync(COMPANY_DATA_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`Shared company CRM contacts/leads saved to ${COMPANY_DATA_FILE}`);
  return COMPANY_DATA_FILE;
}

export function loadSharedCrmDataCompany(): SharedCrmData {
  if (!fs.existsSync(COMPANY_DATA_FILE)) {
    throw new Error(
      `Shared company CRM data not found at ${COMPANY_DATA_FILE}. ` +
        `Run tests/Company category Scenario/Creating Contacts,Leads,Deals.spec.ts first.`,
    );
  }
  const raw = fs.readFileSync(COMPANY_DATA_FILE, 'utf-8');
  const data = JSON.parse(raw) as SharedCrmData;
  if (!Array.isArray(data.contacts) || !Array.isArray(data.leads)) {
    throw new Error(`Invalid company CRM data in ${COMPANY_DATA_FILE} — contacts/leads arrays missing.`);
  }
  if (data.contacts.length === 0 && data.leads.length === 0) {
    throw new Error(`Invalid company CRM data in ${COMPANY_DATA_FILE} — contacts and leads are empty.`);
  }
  return data;
}

export function getSharedCrmDataCompanyPath(): string {
  return COMPANY_DATA_FILE;
}
