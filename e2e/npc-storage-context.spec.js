import { expect, test } from '@playwright/test';

async function openPreview(page, { failBeta = false } = {}) {
    const writes = [];
    await page.route('**/js/app.js*', route => route.fulfill({
        contentType: 'text/javascript', body: 'import "/e2e/fixtures/campaign-context.js";'
    }));
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname === '/api/preview/npcs') {
            const campaignId = url.searchParams.get('campaignId');
            if (request.method() === 'POST') {
                writes.push(JSON.parse(request.postData()));
                await route.fulfill({ json: {} });
            } else if (failBeta && campaignId === 'beta') {
                await route.fulfill({ status: 500, json: { error: 'Campaign unavailable.' } });
            } else {
                await route.fulfill({ json: { npcs: [{ id: 'preview-npc', name: `Guard from ${campaignId}`, rank: 2 }] } });
            }
            return;
        }
        await route.fulfill({ json: request.url().includes('campaign-settings') ? { settings: {} } : { documents: [] } });
    });
    await page.goto('/#tab-campaign');
    await page.locator('#btn-npc-toggle').click();
    return writes;
}

test('shows browser or campaign storage when collapsed and names add/copy destinations', async ({ page }) => {
    const writes = await openPreview(page);
    const destination = page.locator('#npc-storage-destination');
    await expect(destination).toHaveText('NPC storage: This browser');
    await page.locator('#npc-name').fill('Browser Gargoyle');
    await page.locator('#btn-npc-add').click();
    await page.locator('#npc-storage-select').selectOption('beta');
    await expect(page.getByRole('button', { name: 'Add NPC to Wormholes Alpha', exact: true })).toBeEnabled();
    await expect(destination).toHaveText('NPC storage: Wormholes Alpha');
    await expect(page.locator('#npc-storage-note')).toContainText('Shared with all GMs of Wormholes Alpha');
    await expect(page.locator('#npc-summary')).toContainText('Guard from beta');
    await page.locator('#btn-npc-toggle').click();
    await expect(destination).toBeVisible();
    await expect(page.locator('#npc-storage-note')).toBeVisible();
    await page.locator('#campaign-manage-select').selectOption('alpha');
    await expect(destination).toHaveText('NPC storage: Wormholes Alpha');
    await page.locator('#btn-npc-toggle').click();
    await page.getByRole('button', { name: 'Copy browser NPCs to Wormholes Alpha', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Copy browser NPCs?' });
    await expect(dialog).toContainText('into Wormholes Alpha?');
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.locator('#npc-summary')).toContainText('Browser Gargoyle');
    expect(writes[0]).toMatchObject({ campaignId: 'beta', npc: { name: 'Browser Gargoyle' } });
    await page.locator('#npc-name').fill('Campaign Gargoyle');
    await page.getByRole('button', { name: 'Add NPC to Wormholes Alpha', exact: true }).click();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1]).toMatchObject({ campaignId: 'beta', npc: { name: 'Campaign Gargoyle' } });
    await page.locator('#npc-storage-select').selectOption('local');
    await expect(destination).toHaveText('NPC storage: This browser');
    await expect(page.locator('#npc-summary')).toHaveText('Browser Gargoyle R3');
});

test('shows the browser destination and an error when campaign loading fails', async ({ page }) => {
    await openPreview(page, { failBeta: true });
    await page.locator('#npc-name').fill('Local Guard');
    await page.locator('#btn-npc-add').click();
    await page.locator('#npc-storage-select').selectOption('beta');
    await expect(page.locator('#npc-storage-destination')).toHaveText('NPC storage: This browser');
    await expect(page.locator('#npc-storage-note')).toContainText('Showing this browser instead. Campaign unavailable.');
    await expect(page.locator('#npc-storage-select')).toHaveValue('local');
    await expect(page.locator('#npc-summary')).toHaveText('Local Guard R3');
});
