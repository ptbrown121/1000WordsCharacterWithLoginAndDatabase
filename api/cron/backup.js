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
export const PAGE_SIZE = 1000;
export const KEEP_BACKUPS = 8;
export const DEFAULT_LOG_RETENTION_DAYS = 90;
export const DEFAULT_LOG_MAX_ROWS = 5000;

export const BACKUP_TABLES = [
    { name: 'profiles', orderBy: ['id'] },
    { name: 'campaigns', orderBy: ['id'] },
    { name: 'campaign_memberships', orderBy: ['campaign_id', 'user_id'] },
    { name: 'campaign_creators', orderBy: ['user_id'] },
    { name: 'characters', orderBy: ['id'] },
    { name: 'roll_logs', orderBy: ['created_at', 'id'], ascending: false, recentDaysColumn: 'created_at', boundedLog: true },
    { name: 'campaign_ai_settings', orderBy: ['campaign_id'] },
    { name: 'campaign_documents', orderBy: ['id'] },
    { name: 'ai_creation_threads', orderBy: ['id'] },
    { name: 'ai_creation_messages', orderBy: ['id'] },
    { name: 'ai_scene_summaries', orderBy: ['id'] },
    { name: 'ai_agent_run_logs', orderBy: ['created_at', 'id'], ascending: false, recentDaysColumn: 'created_at', boundedLog: true },
    { name: 'campaign_npcs', orderBy: ['id'] },
    { name: 'campaign_files', orderBy: ['id'] }
];

function resolvePositiveInt(rawValue, fallback) {
    const parsed = Number.parseInt(String(rawValue || ''), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function dumpTable(client, table, options = {}) {
    const retentionDays = options.retentionDays ?? resolvePositiveInt(process.env.BACKUP_LOG_RETENTION_DAYS, DEFAULT_LOG_RETENTION_DAYS);
    const maxLogRows = options.maxLogRows ?? resolvePositiveInt(process.env.BACKUP_LOG_MAX_ROWS, DEFAULT_LOG_MAX_ROWS);
    const pageSize = options.pageSize ?? PAGE_SIZE;
    const nowMs = options.nowMs ?? Date.now();
    const rowCap = table.boundedLog ? maxLogRows : Infinity;
    const cutoffIso = table.boundedLog && table.recentDaysColumn
        ? new Date(nowMs - retentionDays * 86_400_000).toISOString()
        : null;

    const rows = [];
    for (let from = 0; rows.length < rowCap; from += pageSize) {
        const limit = Math.min(pageSize, rowCap - rows.length);
        let query = client.from(table.name).select('*');
        if (cutoffIso && table.recentDaysColumn) {
            query = query.gte(table.recentDaysColumn, cutoffIso);
        }
        query = query.range(from, from + limit - 1);
        const ascending = table.ascending !== false;
        table.orderBy.forEach(column => {
            query = query.order(column, { ascending });
        });
        const { data, error } = await query;
        if (error) throw new ApiError(500, `Backup failed reading ${table.name}: ${error.message}`);
        rows.push(...(data || []));
        if (!data || data.length < limit) break;
    }
    return rows;
}

export default async function handler(req, res) {
    try {
        requireMethod(req, ['GET']);
        requireCronSecret(req);

        const client = createServiceClient();
        if (!client) throw new ApiError(500, 'SUPABASE_SECRET_KEY is not configured.');

        const startedAt = new Date().toISOString();
        const nowMs = Date.parse(startedAt);
        const tables = {};
        const counts = {};
        for (const table of BACKUP_TABLES) {
            tables[table.name] = await dumpTable(client, table, { nowMs });
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
