import { createClient } from '@supabase/supabase-js';
import { ApiError } from './http.js';

function env(name, fallbackName = '') {
    return process.env[name] || (fallbackName ? process.env[fallbackName] : '');
}

export function getSupabaseConfig() {
    const url = env('SUPABASE_URL', 'VITE_SUPABASE_URL');
    const anonKey = env('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY');
    if (!url || !anonKey) {
        throw new ApiError(500, 'Supabase server environment variables are not configured.');
    }
    return { url, anonKey };
}

export function extractBearerToken(headers = {}) {
    const value = headers.authorization || headers.Authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(value);
    return match ? match[1].trim() : '';
}

export function createUserClient(token) {
    const { url, anonKey } = getSupabaseConfig();
    return createClient(url, anonKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        },
        global: {
            headers: { Authorization: `Bearer ${token}` }
        }
    });
}

export function createServiceClient() {
    // Prefer the new-style secret API key (sb_secret_..., Settings -> API
    // Keys); the legacy service_role JWT key is deprecated but still
    // accepted as a fallback during the migration.
    const serviceKey = env('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
    if (!serviceKey) return null;
    const { url } = getSupabaseConfig();
    return createClient(url, serviceKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        }
    });
}

export async function requireUser(req) {
    const token = extractBearerToken(req.headers || {});
    if (!token) throw new ApiError(401, 'Sign in is required.');

    const client = createUserClient(token);
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) throw new ApiError(401, 'The current session is invalid or expired.');
    return { client, user: data.user, token };
}

export function assertNoSupabaseError(result, fallbackMessage = 'Database request failed.') {
    if (result.error) throw new ApiError(400, result.error.message || fallbackMessage, result.error);
    return result.data;
}

export async function requireCampaignMember(client, campaignId) {
    if (!campaignId) throw new ApiError(400, 'Campaign id is required.');
    const result = await client.rpc('is_campaign_member', { target_campaign_id: campaignId });
    if (result.error) throw new ApiError(400, result.error.message || 'Could not verify campaign membership.');
    if (!result.data) throw new ApiError(403, 'You are not a member of this campaign.');
}

export async function requireCampaignGm(client, campaignId) {
    if (!campaignId) throw new ApiError(400, 'Campaign id is required.');
    const result = await client.rpc('is_campaign_gm', { target_campaign_id: campaignId });
    if (result.error) throw new ApiError(400, result.error.message || 'Could not verify GM access.');
    if (!result.data) throw new ApiError(403, 'GM access is required for this campaign.');
}

export async function requireOwnedCharacter(client, user, characterId) {
    if (!characterId) throw new ApiError(400, 'Character id is required.');
    const result = await client
        .from('characters')
        .select('id, owner_id, campaign_id, name, state')
        .eq('id', characterId)
        .eq('owner_id', user.id)
        .is('archived_at', null)
        .single();
    const character = assertNoSupabaseError(result, 'Character not found.');
    if (!character) throw new ApiError(404, 'Character not found.');
    return character;
}

export async function loadVisibleCharacter(client, characterId) {
    if (!characterId) throw new ApiError(400, 'Character id is required.');
    const result = await client
        .from('characters')
        .select('id, owner_id, campaign_id, name, state')
        .eq('id', characterId)
        .is('archived_at', null)
        .single();
    return assertNoSupabaseError(result, 'Character not found.');
}

export function safeFileName(value = 'campaign-note.txt') {
    const cleaned = String(value || 'campaign-note.txt')
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);
    return cleaned || 'campaign-note.txt';
}
