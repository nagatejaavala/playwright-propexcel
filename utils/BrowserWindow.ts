import type { Page } from '@playwright/test';

/**
 * Maximize the browser window to fill the display (macOS Chrome ignores --start-maximized alone).
 */
export async function maximizeBrowserWindow(page: Page): Promise<void> {
  try {
    const session = await page.context().newCDPSession(page);
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'maximized' },
    });
    // Also stretch to screen bounds if maximize didn't expand (some Chrome/macOS builds)
    const { bounds } = await session.send('Browser.getWindowBounds', { windowId });
    if (bounds.width && bounds.width < 1400) {
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: {
          left: 0,
          top: 0,
          width: 1920,
          height: 1080,
          windowState: 'normal',
        },
      });
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: { windowState: 'maximized' },
      });
    }
    console.log('Browser window maximized');
  } catch (error) {
    console.log('Browser maximize skipped:', (error as Error).message);
  }
}
