import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => globalThis.localStorage.clear());
    await page.reload();
});

test('creates a character through the accessible prompt dialog', async ({ page }) => {
    await page.locator('#btn-new-char').click();

    const dialog = page.getByRole('dialog', { name: 'New character' });
    const input = dialog.getByRole('textbox', { name: 'Enter a name for your new character:' });
    await expect(dialog).toBeVisible();
    await expect(input).toBeFocused();

    await input.fill('Dialog Test Hero');
    await dialog.getByRole('button', { name: 'Create character' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.locator('#char-name')).toHaveValue('Dialog Test Hero');
});

test('Escape cancels a confirmation and restores its opener', async ({ page }) => {
    const restButton = page.locator('#btn-rest');
    await restButton.click();

    const dialog = page.getByRole('dialog', { name: 'Rest character?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Confirm' })).toBeFocused();

    await page.keyboard.press('Escape');

    await expect(dialog).toBeHidden();
    await expect(restButton).toBeFocused();
});

test('an alert over another modal returns focus inside the underlying modal', async ({ page }) => {
    await page.getByRole('button', { name: '+ Add Tile' }).click();
    await page.locator('#tile-dice').fill('d5');
    const estimateButton = page.locator('#btn-estimate-xp');
    await estimateButton.click();

    const alertDialog = page.getByRole('dialog', { name: 'Notice' });
    await expect(alertDialog).toContainText('Tile dice must use only');
    await alertDialog.getByRole('button', { name: 'OK' }).click();

    await expect(alertDialog).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'Add Tile' })).toBeVisible();
    await expect(estimateButton).toBeFocused();
});
