import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => globalThis.localStorage.clear());
    await page.reload();
});

test('tile modal traps focus, closes with Escape, and restores its opener', async ({ page }) => {
    const opener = page.getByRole('button', { name: '+ Add Tile' });
    await opener.click();

    const dialog = page.getByRole('dialog', { name: 'Add Tile' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#tile-name')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
});

test('help modal exposes its name and keeps keyboard focus inside', async ({ page }) => {
    const opener = page.locator('#btn-info');
    await opener.click();

    const dialog = page.getByRole('dialog', { name: /How to Use This Sheet/ });
    const close = page.getByRole('button', { name: 'Close help' });
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(close).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
});

test('every static modal has accessible dialog metadata', async ({ page }) => {
    const modals = page.locator('.modal');
    await expect(modals).toHaveCount(6);
    const count = await modals.count();
    for (let index = 0; index < count; index += 1) {
        const modal = modals.nth(index);
        await expect(modal).toHaveAttribute('role', 'dialog');
        await expect(modal).toHaveAttribute('aria-modal', 'true');
        await expect(modal).toHaveAttribute('aria-labelledby', /.+/);
        await expect(modal).toHaveAttribute('aria-hidden', 'true');
    }
});
