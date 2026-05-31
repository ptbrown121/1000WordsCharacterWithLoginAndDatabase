import { getQuery, handleApiError, readJson, requireMethod, sendJson } from '../_lib/http.js';
import {
    assertNoSupabaseError,
    requireCampaignGm,
    requireCampaignMember,
    requireUser
} from '../_lib/supabase.js';
import { cleanText, truncateText } from '../_lib/aiWorkflow.js';

export default async function handler(req, res) {
    try {
        requireMethod(req, ['GET', 'POST']);
        const { client, user } = await requireUser(req);

        if (req.method === 'GET') {
            const campaignId = getQuery(req).get('campaignId');
            await requireCampaignMember(client, campaignId);
            const result = await client
                .from('campaign_ai_settings')
                .select('campaign_id, scenario_seed, gm_instructions, updated_at')
                .eq('campaign_id', campaignId)
                .maybeSingle();
            if (result.error) throw result.error;
            sendJson(res, 200, { settings: result.data || null });
            return;
        }

        const body = await readJson(req);
        const campaignId = body.campaignId;
        await requireCampaignGm(client, campaignId);

        const settings = assertNoSupabaseError(await client
            .from('campaign_ai_settings')
            .upsert({
                campaign_id: campaignId,
                scenario_seed: truncateText(cleanText(body.scenarioSeed || ''), 12000),
                gm_instructions: truncateText(cleanText(body.gmInstructions || ''), 12000),
                updated_by: user.id,
                updated_at: new Date().toISOString()
            }, { onConflict: 'campaign_id' })
            .select('campaign_id, scenario_seed, gm_instructions, updated_at')
            .single(), 'Could not save campaign AI settings.');

        sendJson(res, 200, { settings });
    } catch (error) {
        handleApiError(res, error);
    }
}
