import { ApiError, getQuery, handleApiError, readJson, requireMethod, sendJson } from '../_lib/http.js';
import {
    assertNoSupabaseError,
    createServiceClient,
    requireCampaignGm,
    requireCampaignMember,
    requireUser,
    safeFileName
} from '../_lib/supabase.js';
import { cleanText, truncateText } from '../_lib/aiWorkflow.js';

const MAX_CAMPAIGN_DOC_CHARS = 100000;
const STORAGE_BUCKET = 'campaign-ai-documents';

function summarizeCampaignDoc(content) {
    return truncateText(content, 1800);
}

export default async function handler(req, res) {
    try {
        requireMethod(req, ['GET', 'POST']);
        const { client, user } = await requireUser(req);

        if (req.method === 'GET') {
            const campaignId = getQuery(req).get('campaignId');
            await requireCampaignMember(client, campaignId);
            const documents = assertNoSupabaseError(await client
                .from('campaign_documents')
                .select('id, campaign_id, title, file_name, content_summary, metadata, created_at, updated_at')
                .eq('campaign_id', campaignId)
                .order('created_at', { ascending: false }), 'Could not load campaign documents.');
            sendJson(res, 200, { documents: documents || [] });
            return;
        }

        const body = await readJson(req);
        const campaignId = body.campaignId;
        const content = cleanText(body.content || '');
        const title = cleanText(body.title || body.fileName || 'Campaign note');
        const fileName = safeFileName(body.fileName || `${title || 'campaign-note'}.txt`);

        await requireCampaignGm(client, campaignId);
        if (!content) throw new ApiError(400, 'Campaign document text is required.');
        if (content.length > MAX_CAMPAIGN_DOC_CHARS) {
            throw new ApiError(413, `Campaign document text must be ${MAX_CAMPAIGN_DOC_CHARS} characters or less.`);
        }

        const serviceClient = createServiceClient();
        const db = serviceClient || client;
        let storagePath = null;

        if (serviceClient) {
            storagePath = `${campaignId}/${Date.now()}-${fileName}`;
            const upload = await serviceClient.storage
                .from(STORAGE_BUCKET)
                .upload(storagePath, Buffer.from(content, 'utf8'), {
                    contentType: 'text/plain; charset=utf-8',
                    upsert: false
                });
            if (upload.error) {
                console.warn('Could not upload campaign document to storage', upload.error);
                storagePath = null;
            }
        }

        const document = assertNoSupabaseError(await db
            .from('campaign_documents')
            .insert({
                campaign_id: campaignId,
                uploaded_by: user.id,
                title: title || fileName,
                file_name: fileName,
                storage_path: storagePath,
                content_text: content,
                content_summary: summarizeCampaignDoc(content),
                metadata: {
                    source: body.source || 'ai-doc-panel',
                    storedInBucket: Boolean(storagePath)
                }
            })
            .select('id, campaign_id, title, file_name, content_summary, metadata, created_at, updated_at')
            .single(), 'Could not save campaign document.');

        sendJson(res, 201, { document });
    } catch (error) {
        handleApiError(res, error);
    }
}
