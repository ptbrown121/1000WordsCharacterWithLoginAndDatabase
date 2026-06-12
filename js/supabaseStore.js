import { normalizeImportedState } from './data.js';

function assertNoError(result) {
    if (result.error) throw result.error;
    return result.data;
}

function generateInviteCode() {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 10).toUpperCase();
}

function campaignNameById(campaigns) {
    return new Map(campaigns.map(campaign => [campaign.id, campaign.name]));
}

export class SupabaseCharacterStore {
    constructor(client, user) {
        this.client = client;
        this.user = user;
    }

    async ensureProfile() {
        const email = this.user.email || '';
        assertNoError(await this.client
            .from('profiles')
            .upsert({
                id: this.user.id,
                email,
                display_name: email.split('@')[0] || 'Player',
                updated_at: new Date().toISOString()
            }, { onConflict: 'id' }));
    }

    async listRoster() {
        await this.ensureProfile();

        let canCreateCampaign = false;
        try {
            canCreateCampaign = Boolean(assertNoError(await this.client.rpc('can_create_campaign')));
        } catch (error) {
            console.warn('Could not load campaign creation permission', error);
        }

        const memberships = assertNoError(await this.client
            .from('campaign_memberships')
            .select('campaign_id, role, campaigns(id, name, invite_code)')
            .eq('user_id', this.user.id));

        const campaigns = memberships
            .filter(row => row.campaigns)
            .map(row => ({
                id: row.campaign_id,
                name: row.campaigns.name,
                inviteCode: row.campaigns.invite_code,
                role: row.role
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const nameMap = campaignNameById(campaigns);
        const owned = assertNoError(await this.client
            .from('characters')
            .select('id, name, owner_id, campaign_id, updated_at')
            .eq('owner_id', this.user.id)
            .is('archived_at', null)
            .order('updated_at', { ascending: false }));

        const gmCampaignIds = campaigns
            .filter(campaign => campaign.role === 'gm')
            .map(campaign => campaign.id);

        let campaignCharacters = [];
        if (gmCampaignIds.length > 0) {
            campaignCharacters = assertNoError(await this.client
                .from('characters')
                .select('id, name, owner_id, campaign_id, updated_at')
                .in('campaign_id', gmCampaignIds)
                .neq('owner_id', this.user.id)
                .is('archived_at', null)
                .order('updated_at', { ascending: false }));
        }

        const ownedRoster = owned.map(row => ({
            id: row.id,
            name: row.name || 'Unnamed',
            source: 'cloud',
            group: 'My Characters',
            isMine: true,
            readOnly: false,
            ownerId: row.owner_id,
            campaignId: row.campaign_id,
            campaignName: nameMap.get(row.campaign_id) || ''
        }));

        const gmRoster = campaignCharacters.map(row => ({
            id: row.id,
            name: row.name || 'Unnamed',
            source: 'cloud',
            group: `${nameMap.get(row.campaign_id) || 'Campaign'} Characters`,
            isMine: false,
            readOnly: true,
            ownerId: row.owner_id,
            campaignId: row.campaign_id,
            campaignName: nameMap.get(row.campaign_id) || ''
        }));

        return { roster: [...ownedRoster, ...gmRoster], campaigns, canCreateCampaign };
    }

    async loadCharacter(id) {
        const row = assertNoError(await this.client
            .from('characters')
            .select('state')
            .eq('id', id)
            .single());
        return normalizeImportedState(row.state) || row.state;
    }

    async saveCharacter(id, state) {
        const cleanState = normalizeImportedState(JSON.parse(JSON.stringify(state)));
        assertNoError(await this.client
            .from('characters')
            .update({
                name: cleanState.name || 'Unnamed',
                state: cleanState,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('owner_id', this.user.id));
    }

    async createCharacter(name, state, campaignId = null) {
        const cleanState = normalizeImportedState(JSON.parse(JSON.stringify(state)));
        cleanState.name = name || cleanState.name || 'Hero Name';
        const row = assertNoError(await this.client
            .from('characters')
            .insert({
                owner_id: this.user.id,
                campaign_id: campaignId || null,
                name: cleanState.name,
                state: cleanState
            })
            .select('id')
            .single());
        return row.id;
    }

    async archiveCharacter(id) {
        assertNoError(await this.client
            .from('characters')
            .update({ archived_at: new Date().toISOString() })
            .eq('id', id)
            .eq('owner_id', this.user.id));
    }

    async assignCharacterToCampaign(characterId, campaignId) {
        assertNoError(await this.client
            .from('characters')
            .update({ campaign_id: campaignId || null, updated_at: new Date().toISOString() })
            .eq('id', characterId)
            .eq('owner_id', this.user.id));
    }

    async createCampaign(name) {
        if (!await this.canCreateCampaign()) {
            throw new Error('Your account is not allowed to create campaigns.');
        }

        const cleanName = String(name || '').trim() || 'New Campaign';
        const campaign = assertNoError(await this.client
            .from('campaigns')
            .insert({
                name: cleanName,
                owner_id: this.user.id,
                invite_code: generateInviteCode()
            })
            .select('id, name, invite_code')
            .single());

        assertNoError(await this.client
            .from('campaign_memberships')
            .insert({
                campaign_id: campaign.id,
                user_id: this.user.id,
                role: 'gm'
            }));

        return {
            id: campaign.id,
            name: campaign.name,
            inviteCode: campaign.invite_code,
            role: 'gm'
        };
    }

    async canCreateCampaign() {
        try {
            return Boolean(assertNoError(await this.client.rpc('can_create_campaign')));
        } catch (error) {
            console.warn('Could not confirm campaign creation permission', error);
            return false;
        }
    }

    async joinCampaign(inviteCode) {
        const code = String(inviteCode || '').trim().toUpperCase();
        return assertNoError(await this.client.rpc('join_campaign_by_code', { invite_code_input: code }));
    }

    async listCampaignMembers(campaignId) {
        const rows = assertNoError(await this.client
            .from('campaign_memberships')
            .select('campaign_id, user_id, role, profiles(email, display_name)')
            .eq('campaign_id', campaignId)
            .order('role', { ascending: true }));

        return rows.map(row => ({
            campaignId: row.campaign_id,
            userId: row.user_id,
            role: row.role,
            email: row.profiles?.email || '',
            displayName: row.profiles?.display_name || row.profiles?.email || 'Player'
        }));
    }

    async setCampaignMemberRole(campaignId, userId, role) {
        assertNoError(await this.client
            .from('campaign_memberships')
            .update({ role })
            .eq('campaign_id', campaignId)
            .eq('user_id', userId));
    }

    // Campaign NPCs (GM-only; RLS rejects every operation for non-GMs). The
    // row id doubles as the NPC id so the browser's list and the table stay
    // in one-to-one correspondence.
    async listCampaignNpcs(campaignId) {
        const rows = assertNoError(await this.client
            .from('campaign_npcs')
            .select('id, data')
            .eq('campaign_id', campaignId)
            .order('created_at', { ascending: true }));
        return rows.map(row => ({ ...(row.data || {}), id: row.id }));
    }

    async saveCampaignNpc(campaignId, npc) {
        assertNoError(await this.client
            .from('campaign_npcs')
            .upsert({
                id: npc.id,
                campaign_id: campaignId,
                created_by: this.user.id,
                name: npc.name || 'NPC',
                data: npc,
                updated_at: new Date().toISOString()
            }, { onConflict: 'id' }));
    }

    async deleteCampaignNpc(npcId) {
        assertNoError(await this.client
            .from('campaign_npcs')
            .delete()
            .eq('id', npcId));
    }

    // Campaign files (GM-only): PowerPoint maps/decks as storage objects
    // plus a metadata row. Paths start with the campaign id so the storage
    // RLS policies can authorize from the path alone.
    async listCampaignFiles(campaignId) {
        const rows = assertNoError(await this.client
            .from('campaign_files')
            .select('id, title, file_name, storage_path, content_type, size_bytes, created_at')
            .eq('campaign_id', campaignId)
            .order('created_at', { ascending: false }));
        return rows.map(row => ({
            id: row.id,
            title: row.title || row.file_name,
            fileName: row.file_name,
            storagePath: row.storage_path,
            contentType: row.content_type,
            sizeBytes: row.size_bytes,
            createdAt: row.created_at
        }));
    }

    async uploadCampaignFile(campaignId, file, title) {
        // Some platforms report an empty mime type; infer it from the
        // extension so the bucket's allowlist can still accept the upload.
        const mimeByExtension = {
            ppt: 'application/vnd.ms-powerpoint',
            pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow'
        };
        const extension = (file.name || '').split('.').pop().toLowerCase();
        const contentType = file.type || mimeByExtension[extension] || '';
        const safeName = String(file.name || 'presentation.pptx').replace(/[^\w.\- ]+/g, '_');
        const storagePath = `${campaignId}/${crypto.randomUUID()}-${safeName}`;

        assertNoError(await this.client.storage
            .from('campaign-files')
            .upload(storagePath, file, { contentType, upsert: false }));

        try {
            const row = assertNoError(await this.client
                .from('campaign_files')
                .insert({
                    campaign_id: campaignId,
                    uploaded_by: this.user.id,
                    title: String(title || '').trim() || file.name,
                    file_name: file.name,
                    storage_path: storagePath,
                    content_type: contentType,
                    size_bytes: file.size || 0
                })
                .select('id, title, file_name, storage_path, content_type, size_bytes, created_at')
                .single());
            return {
                id: row.id,
                title: row.title || row.file_name,
                fileName: row.file_name,
                storagePath: row.storage_path,
                contentType: row.content_type,
                sizeBytes: row.size_bytes,
                createdAt: row.created_at
            };
        } catch (error) {
            // The metadata row failed: remove the blob so it cannot become
            // an orphan invisible to the file list.
            await this.client.storage.from('campaign-files').remove([storagePath]);
            throw error;
        }
    }

    async getCampaignFileDownloadUrl(storagePath, downloadName) {
        const data = assertNoError(await this.client.storage
            .from('campaign-files')
            .createSignedUrl(storagePath, 300, { download: downloadName || true }));
        return data.signedUrl;
    }

    async deleteCampaignFile(file) {
        assertNoError(await this.client.storage
            .from('campaign-files')
            .remove([file.storagePath]));
        assertNoError(await this.client
            .from('campaign_files')
            .delete()
            .eq('id', file.id));
    }

    async recordRollLog(log) {
        assertNoError(await this.client
            .from('roll_logs')
            .insert(log));
    }

    async listRecentRollLogs(campaignId, limit = 50) {
        if (!campaignId) return [];
        const rows = assertNoError(await this.client
            .from('roll_logs')
            .select('id, character_name, roll_mode, call_colors, called_tiles, total, adds, haywire, rolled_at')
            .eq('campaign_id', campaignId)
            .eq('is_test', false)
            .order('rolled_at', { ascending: false })
            .limit(limit));

        return rows.map(row => ({
            id: row.id,
            characterName: row.character_name,
            mode: row.roll_mode,
            callColors: row.call_colors || [],
            calledTiles: row.called_tiles || [],
            total: row.total,
            adds: row.adds,
            haywire: row.haywire,
            rolledAt: row.rolled_at
        }));
    }
}
