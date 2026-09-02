import { test as base, expect } from '@playwright/test';
import { maximizeBrowserWindow } from './BrowserWindow';

/**
 * Shared Playwright test that maximizes the headed Chrome window on every run.
 * Specs should: import { test, expect } from '../utils/test';
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await maximizeBrowserWindow(page);
    await use(page);
  },
});

export { expect };
export type { Page, Locator, BrowserContext } from '@playwright/test';
