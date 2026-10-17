import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.route('**/js/app.js*', route => route.fulfill({
        contentType: 'text/javascript', body: 'import "/e2e/fixtures/character-save-status.js";'
    }));
    await page.goto('/');
});

test('keeps browser-only warnings visible when sign-in is collapsed and exports a backup', async ({ page }) => {
    await page.locator('#btn-cloud-toggle').click();
    await expect(page.locator('#cloud-panel-body')).toBeHidden();
    await expect(page.locator('#character-backup-title')).toHaveText('Only saved in this browser — no cloud backup');
    await expect(page.locator('#character-campaign-title')).toHaveText('No campaign assigned');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#btn-character-backup-export').click();
    expect((await downloadPromise).suggestedFilename()).toMatch(/^1000words_.*\.json$/);
    await page.locator('#btn-character-backup').click();
    await expect(page.locator('#cloud-panel-body')).toBeVisible();
    await expect(page.locator('#btn-auth-google')).toBeFocused();

    await page.getByRole('tab', { name: /Story/ }).click();
    await expect(page.locator('#character-backup-status')).toBeVisible();
    const widths = await page.evaluate(() => ({ content: globalThis.document.documentElement.scrollWidth, viewport: globalThis.innerWidth }));
    expect(widths.content).toBeLessThanOrEqual(widths.viewport);
});

test('sign-in and campaign joining still require upload and character assignment', async ({ page }) => {
    await page.evaluate(async () => (await import('/e2e/fixtures/character-save-status.js')).signIn());
    await expect(page.locator('#character-backup-detail')).toContainText('Signing in does not upload');
    await page.getByRole('tab', { name: /Campaign/ }).click();
    await page.locator('#campaign-code-input').fill('TEST-CODE');
    await page.locator('#btn-join-campaign').click();
    await expect(page.locator('#cloud-status-text')).toHaveText('Campaign joined.');
    await expect(page.locator('#character-backup-title')).toContainText('no cloud backup');
    await expect(page.locator('#character-campaign-title')).toHaveText('No campaign assigned');

    await page.getByRole('tab', { name: /Play/ }).click();
    await page.locator('#btn-character-backup').click();
    await expect(page.locator('#character-backup-title')).toHaveText('Saved to your account');
    await expect(page.locator('#character-campaign-title')).toHaveText('No campaign assigned');
    await page.locator('#btn-character-campaign').click();
    await expect(page.locator('#character-campaign-select')).toBeFocused();
    await page.locator('#character-campaign-select').selectOption('wormholes');
    await expect(page.locator('#character-campaign-title')).toHaveText('Campaign: Wormholes Alpha');
    await expect(page.locator('#character-campaign-status')).toHaveAttribute('data-state', 'saved');

    await page.evaluate(async () => {
        const { manager } = await import('/e2e/fixtures/character-save-status.js');
        await manager.switchCharacter(manager.localRoster[0].id);
    });
    await expect(page.locator('#character-backup-title')).toContainText('no cloud backup');
    await expect(page.locator('#character-campaign-title')).toHaveText('No campaign assigned');
});

test('offers joining when a cloud character has no campaign memberships', async ({ page }) => {
    await page.evaluate(async () => (await import('/e2e/fixtures/character-save-status.js')).signIn());
    await page.locator('#btn-character-backup').click();
    await expect(page.locator('#btn-character-campaign')).toHaveText('Join a campaign');
    await page.locator('#btn-character-campaign').click();
    await expect(page.locator('#campaign-code-input')).toBeFocused();
});

test('identifies the owner when a GM views another player’s cloud character', async ({ page }) => {
    await page.evaluate(async () => (await import('/e2e/fixtures/character-save-status.js')).signIn());
    await page.locator('#btn-character-backup').click();
    await expect(page.locator('#character-backup-title')).toHaveText('Saved to your account');
    await page.evaluate(async () => {
        const { manager } = await import('/e2e/fixtures/character-save-status.js');
        manager.activeRosterEntry.isMine = false;
        manager.activeRosterEntry.readOnly = true;
        manager.setCloudStatus('read-only');
    });
    await expect(page.locator('#character-backup-title')).toHaveText('Saved to player’s account');
    await expect(page.locator('#btn-character-backup')).toBeHidden();
    await expect(page.locator('#btn-character-campaign')).toBeHidden();
});

test('keeps the warning after a failed upload and distinguishes pending, failed, and completed saves', async ({ page }) => {
    await page.evaluate(async () => {
        const fixture = await import('/e2e/fixtures/character-save-status.js');
        await fixture.signIn();
        fixture.failUpload(true);
    });
    await page.locator('#btn-character-backup').click();
    await expect(page.locator('#cloud-status-text')).toContainText('Upload unavailable');
    await expect(page.locator('#character-backup-title')).toContainText('no cloud backup');
    await expect(page.locator('#btn-character-backup')).toBeEnabled();
    await page.evaluate(async () => (await import('/e2e/fixtures/character-save-status.js')).failUpload(false));
    await page.locator('#btn-character-backup').click();
    await expect(page.locator('#character-backup-title')).toHaveText('Saved to your account');

    await page.evaluate(async () => {
        const fixture = await import('/e2e/fixtures/character-save-status.js');
        fixture.holdSave();
        fixture.manager.state.xpEarned += 1;
        fixture.manager.saveState();
    });
    await expect(page.locator('#character-backup-title')).toContainText('waiting for cloud save');
    await expect(page.locator('#btn-character-backup-export')).toBeVisible();
    await page.evaluate(async () => (await import('/e2e/fixtures/character-save-status.js')).finishSave(true));
    await expect(page.locator('#character-backup-status')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('#character-backup-detail')).toContainText('Connection lost');
    await page.evaluate(async () => (await import('/e2e/fixtures/character-save-status.js')).retrySave());
    await expect(page.locator('#character-backup-title')).toHaveText('Saved to your account');
    await expect(page.locator('#btn-character-backup-export')).toBeHidden();
});
