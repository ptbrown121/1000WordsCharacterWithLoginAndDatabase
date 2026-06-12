import { gzipSync } from 'node:zlib';
import { ApiError, handleApiError, requireMethod, sendJson } from '../_lib/http.js';
import { requireCronSecret } from '../_lib/cron.js';
import { createServiceClient } from '../_lib/supabase.js';

// Weekly dump of every table the app writes, stored as gzipped JSON in the
// private `backups` bucket (no storage policies - secret key only). File
// blobs in campaign-files / campaign-ai-documents are not duplicated;
// storage itself is their backup and the metadata rows are included here.
//
// The order columns make PostgREST range pagination stable; each is the
// table's primary key (with a tiebreak for the composite-keyed
// memberships table).
const BACKUP_TABLES = [
    { name: 'profiles', orderBy: ['id'] },
    { name: 'campaigns', orderBy: ['id'] },
    { name: 'campaign_memberships', orderBy: ['campaign_id', 'user_id'] },
    { name: 'campaign_creators', orderBy: ['user_id'] },
    { name: 'characters', orderBy: ['id'] },
    { name: 'roll_logs', orderBy: ['id'] },
    { name: 'campaign_ai_settings', orderBy: ['campaign_id'] },
    { name: 'campaign_documents', orderBy: ['id'] },
    { name: 'ai_creation_threads', orderBy: ['id'] },
    { name: 'ai_creation_messages', orderBy: ['id'] },
    { name: 'ai_scene_summaries', orderBy: ['id'] },
    { name: 'ai_agent_run_logs', orderBy: ['id'] },
    { name: 'campaign_npcs', orderBy: ['id'] },
    { name: 'campaign_files', orderBy: ['id'] }
];

const PAGE_SIZE = 1000;
const KEEP_BACKUPS = 8;

async function dumpTable(client, table) {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
        let query = client.from(table.name).select('*').range(from, from + PAGE_SIZE - 1);
        table.orderBy.forEach(column => {
            query = query.order(column, { ascending: true });
        });
        const { data, error } = await query;
        if (error) throw new ApiError(500, `Backup failed reading ${table.name}: ${error.message}`);
        rows.push(...(data || []));
        if (!data || data.length < PAGE_SIZE) return rows;
    }
}

export default async function handler(req, res) {
    try {
        requireMethod(req, ['GET']);
        requireCronSecret(req);

        const client = createServiceClient();
        if (!client) throw new ApiError(500, 'SUPABASE_SECRET_KEY is not configured.');

        const startedAt = new Date().toISOString();
        const tables = {};
        const counts = {};
        for (const table of BACKUP_TABLES) {
            tables[table.name] = await dumpTable(client, table);
            counts[table.name] = tables[table.name].length;
        }

        const payload = gzipSync(JSON.stringify({ version: 1, startedAt, counts, tables }));
        const fileName = `backup-${startedAt.slice(0, 10)}.json.gz`;
        const upload = await client.storage.from('backups').upload(fileName, payload, {
            contentType: 'application/gzip',
            upsert: true
        });
        if (upload.error) throw new ApiError(500, `Backup upload failed: ${upload.error.message}`);

        // Backup names sort by date, so keep the newest KEEP_BACKUPS and
        // remove the rest. A prune failure does not fail the backup.
        const listing = await client.storage.from('backups').list('', { limit: 100 });
        if (!listing.error && Array.isArray(listing.data)) {
            const stale = listing.data
                .map(file => file.name)
                .filter(name => name.startsWith('backup-'))
                .sort()
                .reverse()
                .slice(KEEP_BACKUPS);
            if (stale.length > 0) await client.storage.from('backups').remove(stale);
        }

        sendJson(res, 200, { ok: true, file: fileName, bytes: payload.length, counts });
    } catch (error) {
        handleApiError(res, error);
    }
}
