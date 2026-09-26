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

describe('vercel.json security headers', () => {
    const rule = config.headers.find(candidate => candidate.source === '/(.*)');
    const headers = Object.fromEntries((rule?.headers || []).map(header => [header.key, header.value]));

    it('sends the security headers on every path', () => {
        assert.equal(headers['X-Content-Type-Options'], 'nosniff');
        assert.equal(headers['X-Frame-Options'], 'DENY');
        assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
        assert.match(headers['Permissions-Policy'], /microphone=\(self\)/);
    });

    it('keeps scripts same-origin and the page unframeable', () => {
        const directives = Object.fromEntries(headers['Content-Security-Policy'].split(';').map(part => {
            const [name, ...values] = part.trim().split(/\s+/);
            return [name, values];
        }));
        assert.deepEqual(directives['script-src'], ["'self'"]);
        assert.deepEqual(directives['frame-ancestors'], ["'none'"]);
        assert.deepEqual(directives['object-src'], ["'none'"]);
        assert.ok(directives['connect-src'].includes('wss://*.supabase.co'), 'live sync needs the realtime websocket');
    });
});
