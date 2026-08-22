import fs from 'fs';
import path from 'path';

/**
 * Categories used for BOTH tenant request and vendor create in Flow 2.
 * Only include names that exist in both dropdowns.
 *
 * Request (confirmed): Maintenance, Repair, Cleaning, Pest Control, Plumbing,
 *   Electrical, HVAC, Appliance, General, Emergency, Other
 * Vendor (confirmed): Maintenance, Cleaning, IT Services, Utilities,
 *   Office Supplies, Consulting, Legal, Marketing, Security, Transport, Other
 *
 * Overlap: Maintenance, Cleaning, Other
 */
export const SHARED_CATEGORIES = [
  'Maintenance',
  'Cleaning',
  'Other',
] as const;

const DATA_DIR = path.join(process.cwd(), 'test-data');
const DATA_FILE = path.join(DATA_DIR, 'last-category.json');

export type LastCategoryData = {
  index: number;
  category: string;
  savedAt: string;
};

/**
 * Next category in rotation for this Flow 2 run.
 * Override with: CATEGORY=Cleaning npx playwright test ...
 */
export function nextSharedCategory(): string {
  const override = process.env.CATEGORY?.trim();
  if (override) {
    console.log(`Shared category from CATEGORY env: ${override}`);
    return override;
  }

  let lastIndex = -1;
  if (fs.existsSync(DATA_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as LastCategoryData;
      if (typeof data.index === 'number' && Number.isFinite(data.index)) {
        const byName = SHARED_CATEGORIES.findIndex(
          (c) => c.toLowerCase() === String(data.category || '').toLowerCase(),
        );
        lastIndex = byName >= 0 ? byName : data.index;
        // If saved category is no longer in the list, start fresh
        if (byName < 0 && !SHARED_CATEGORIES.includes(data.category as typeof SHARED_CATEGORIES[number])) {
          lastIndex = -1;
        }
      }
    } catch {
      // ignore corrupt file — start from first category
    }
  }

  const index = (lastIndex + 1) % SHARED_CATEGORIES.length;
  const category = SHARED_CATEGORIES[index];
  const payload: LastCategoryData = {
    index,
    category,
    savedAt: new Date().toISOString(),
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(
    `Shared category for this run: ${category} (${index + 1}/${SHARED_CATEGORIES.length})`,
  );
  return category;
}
