import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const cronRoutes = readdirSync(new URL('../api/cron/', import.meta.url))
    .filter(file => file.endsWith('.js'))
    .map(file => `/api/cron/${file.replace(/\.js$/, '')}`);

describe('vercel.json cron schedule', () => {
    it('schedules every api/cron route', () => {
        const scheduled = (config.crons || []).map(cron => cron.path).sort();
        assert.deepEqual(scheduled, [...cronRoutes].sort());
    });

    it('stays within the Hobby plan limit of two daily-or-coarser jobs', () => {
        assert.ok(config.crons.length <= 2);
        for (const cron of config.crons) {
            const [minute, hour] = cron.schedule.split(' ');
            assert.match(minute, /^\d+$/, `${cron.path} must run at a fixed minute`);
            assert.match(hour, /^\d+$/, `${cron.path} must run at a fixed hour`);
        }
    });
});
