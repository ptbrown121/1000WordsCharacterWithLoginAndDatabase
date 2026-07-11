import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => globalThis.localStorage.clear());
    await page.reload();
});

test('supports arrow, Home, and End keyboard navigation across tabs', async ({ page }) => {
    const play = page.getByRole('tab', { name: /Play/ });
    const story = page.getByRole('tab', { name: /Story/ });
    const campaign = page.getByRole('tab', { name: /Campaign/ });

    await play.focus();
    await page.keyboard.press('ArrowRight');
    await expect(story).toBeFocused();
    await expect(story).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('End');
    await expect(campaign).toBeFocused();
    await expect(page.locator('#tab-panel-campaign')).toBeVisible();

    await page.keyboard.press('Home');
    await expect(play).toBeFocused();
    await expect(page.locator('#tab-panel-play')).toBeVisible();
});

test('surfaces storage failures, exports recovery JSON, and honors dismissal', async ({ page }) => {
    await page.evaluate(() => {
        globalThis.dispatchEvent(new CustomEvent('storage-error', {
            detail: { operation: 'saveState', error: new Error('quota exceeded') }
        }));
    });

    const banner = page.locator('#storage-error-banner');
    await expect(banner).toBeVisible();
    await expect(page.locator('#storage-error-banner-detail')).toContainText('saving your character');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#btn-storage-error-export').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^1000words_.*\.json$/);

    await page.locator('#btn-storage-error-dismiss').click();
    await expect(banner).toBeHidden();
    await page.evaluate(() => {
        globalThis.dispatchEvent(new CustomEvent('storage-error', {
            detail: { operation: 'saveRoster', error: new Error('still unavailable') }
        }));
    });
    await expect(banner).toBeHidden();
});
