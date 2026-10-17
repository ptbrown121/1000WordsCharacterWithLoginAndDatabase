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

test('Back closes help without navigating away or losing sheet edits', async ({ page }) => {
    const url = page.url();
    const name = page.locator('#char-name');
    await name.fill('Android Back Hero');
    await page.locator('#btn-info').click();
    const dialog = page.locator('#info-modal');
    await expect(dialog).toBeVisible();

    await page.goBack();

    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(url);
    await expect(name).toHaveValue('Android Back Hero');
    await expect(page.locator('#btn-info')).toBeFocused();
});

for (const dismissal of ['close button', 'Escape', 'backdrop']) {
    test(`closing help with ${dismissal} leaves no extra Back step`, async ({ page }) => {
        const url = page.url();
        // Seed a preceding same-document destination so an extra Back is visible.
        await page.evaluate(() => {
            globalThis.history.replaceState({ previous: true }, '', '#previous');
            globalThis.history.pushState({ sheet: true }, '', globalThis.location.pathname);
        });
        for (let attempt = 0; attempt < 2; attempt += 1) {
            await page.locator('#btn-info').click();
            await expect(page.locator('#info-modal')).toBeVisible();
            if (dismissal === 'close button') {
                await page.locator('#btn-info-close').click();
            } else if (dismissal === 'Escape') {
                await page.keyboard.press('Escape');
            } else {
                await page.locator('#info-modal').click({ position: { x: 5, y: 5 } });
            }
            await expect(page.locator('#info-modal')).toBeHidden();
            await expect.poll(() => page.evaluate(() => globalThis.history.state)).toEqual({ sheet: true });
        }

        await page.goBack();
        await expect(page).toHaveURL(`${url}#previous`);
    });
}

test('every static modal has accessible dialog metadata', async ({ page }) => {
    const modals = page.locator('.modal');
    await expect(modals).toHaveCount(8);
    const count = await modals.count();
    for (let index = 0; index < count; index += 1) {
        const modal = modals.nth(index);
        await expect(modal).toHaveAttribute('role', 'dialog');
        await expect(modal).toHaveAttribute('aria-modal', 'true');
        await expect(modal).toHaveAttribute('aria-labelledby', /.+/);
        await expect(modal).toHaveAttribute('aria-hidden', 'true');
    }
});
