import { ApiError, getQuery, handleApiError, readJson, requireMethod, sendJson } from '../_lib/http.js';
import { fetchLatestThreadForCharacter, fetchThreadBundle } from '../_lib/aiData.js';
import {
    assertNoSupabaseError,
    loadVisibleCharacter,
    requireCampaignMember,
    requireOwnedCharacter,
    requireUser
} from '../_lib/supabase.js';

function welcomeMessage(character) {
    const name = character?.name || character?.state?.name || 'your character';
    return `Let us build a backstory scene for ${name}. Tell me about one moment before the campaign where they had to make a choice, take a risk, or reveal what mattered to them.`;
}

export default async function handler(req, res) {
    try {
        requireMethod(req, ['GET', 'POST']);
        const { client, user } = await requireUser(req);

        if (req.method === 'GET') {
            const characterId = getQuery(req).get('characterId');
            await loadVisibleCharacter(client, characterId);
            const bundle = await fetchLatestThreadForCharacter(client, characterId);
            sendJson(res, 200, { bundle });
            return;
        }

        const body = await readJson(req);
        const character = await requireOwnedCharacter(client, user, body.characterId);
        const campaignId = body.campaignId || character.campaign_id;
        if (!campaignId || campaignId !== character.campaign_id) {
            throw new ApiError(400, 'Choose a cloud character that belongs to a campaign before starting AI creation.');
        }
        await requireCampaignMember(client, campaignId);

        const existing = await fetchLatestThreadForCharacter(client, character.id);
        if (existing?.thread && ['active', 'ready_for_summary', 'summary_pending', 'paused'].includes(existing.thread.status)) {
            sendJson(res, 200, { bundle: existing });
            return;
        }

        const thread = assertNoSupabaseError(await client
            .from('ai_creation_threads')
            .insert({
                campaign_id: campaignId,
                character_id: character.id,
                owner_id: user.id,
                status: 'active',
                current_scene_title: 'Opening backstory scene',
                current_scene_goal: 'Establish one vivid pre-campaign event, the character choice inside it, and one consequence.'
            })
            .select('id')
            .single(), 'Could not start AI creation thread.');

        assertNoSupabaseError(await client
            .from('ai_creation_messages')
            .insert({
                thread_id: thread.id,
                role: 'assistant',
                content: welcomeMessage(character),
                metadata: { source: 'thread-welcome' }
            }), 'Could not write welcome message.');

        sendJson(res, 201, { bundle: await fetchThreadBundle(client, thread.id) });
    } catch (error) {
        handleApiError(res, error);
    }
}
