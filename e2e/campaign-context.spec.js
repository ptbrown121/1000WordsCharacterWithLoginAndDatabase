import { expect, test } from '@playwright/test';

test('keeps the managed campaign and save/upload destinations aligned', async ({ page }) => {
    const writes = [];
    let finishSave;
    const saveGate = new Promise(resolve => { finishSave = resolve; });
    await page.route('**/js/app.js*', route => route.fulfill({
        contentType: 'text/javascript', body: 'import "/e2e/fixtures/campaign-context.js";'
    }));
    await page.route('**/api/**', async route => {
        const request = route.request();
        const body = request.method() === 'POST' ? JSON.parse(request.postData()) : null;
        if (body) writes.push(body);
        let payload;
        if (request.url().includes('campaign-settings')) {
            if (body) await saveGate;
            payload = { settings: { scenario_seed: body?.scenarioSeed || '', gm_instructions: body?.gmInstructions || '' } };
        } else if (request.url().includes('campaign-documents')) {
            payload = body ? { document: { title: body.title, content_summary: body.content } } : { documents: [] };
        } else {
            payload = { ...body, id: 'preview-file', sizeBytes: 1024 };
        }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) });
    });
    await page.goto('/#tab-campaign');
    const picker = page.locator('#campaign-manage-select');
    await expect(picker).toBeEnabled();
    await picker.selectOption('beta');
    await expect(page.getByRole('heading', { name: 'Wormholes Alpha', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload to Wormholes Alpha', exact: true })).toBeVisible();
    await expect(picker).toBeEnabled();
    await page.getByLabel('Scenario seed', { exact: true }).fill('A new opening premise');
    await page.getByLabel('GM guidance', { exact: true }).fill('Ask about the vanished moon');
    await page.getByRole('button', { name: 'Save guidance to Wormholes Alpha', exact: true }).click();
    await expect(picker).toBeDisabled();
    await expect(page.locator('#campaign-ai-docs-status')).toHaveText('Saving AI guidance to Wormholes Alpha...');
    finishSave();
    await expect(page.locator('#campaign-ai-docs-status')).toHaveText('AI guidance saved to Wormholes Alpha.');
    expect(writes[0]).toEqual({ campaignId: 'beta', scenarioSeed: 'A new opening premise', gmInstructions: 'Ask about the vanished moon' });
    await page.locator('#campaign-ai-doc-title').fill('Opening scene');
    await page.locator('#campaign-ai-doc-text').fill('A quiet spaceport.');
    await page.getByRole('button', { name: 'Save note to Wormholes Alpha', exact: true }).click();
    await expect(page.locator('#campaign-ai-docs-status')).toHaveText('Campaign note saved to Wormholes Alpha.');
    expect(writes[1]).toMatchObject({ campaignId: 'beta', title: 'Opening scene', content: 'A quiet spaceport.' });
    await page.locator('#campaign-file-input').setInputFiles({ name: 'battle-map.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from('synthetic test file') });
    await page.getByRole('button', { name: 'Upload to Wormholes Alpha', exact: true }).click();
    await expect(page.locator('#campaign-files-status')).toContainText('uploaded to Wormholes Alpha.');
    expect(writes[2]).toMatchObject({ campaignId: 'beta', fileName: 'battle-map.pptx' });
    await page.evaluate(() => globalThis.dispatchEvent(new Event('cloud-status-change')));
    await expect(picker).toHaveValue('beta');
    await expect(page.locator('#character-campaign-select')).toHaveValue('player');
    await picker.selectOption('alpha');
    await expect(page.getByRole('button', { name: 'Save guidance to TestCampaign', exact: true })).toBeEnabled();
    await expect(page.locator('#campaign-ai-doc-list')).not.toContainText('Opening scene');
});
