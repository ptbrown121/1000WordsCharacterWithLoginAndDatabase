import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_HITCH_VALUE,
    TAG_PREFIXES,
    parseTag,
    parseTags,
    serializeTag
} from '../js/tag-model.js';
import { getHitchValue, getTileShieldCrits, getTileWhileForms } from '../js/pool.js';

// This file is the contract for the engine's adoption of parsed tags
// (platform plan PR 8): every string form the pool.js regexes accept today
// must parse to the same meaning here.

describe('parseTag prefixes and exempt suffix', () => {
    it('recognizes all seven prefixes case-insensitively', () => {
        for (const prefix of TAG_PREFIXES) {
            const display = prefix[0].toUpperCase() + prefix.slice(1);
            assert.equal(parseTag(`${display}: Foo`).prefix, prefix);
            assert.equal(parseTag(`${prefix.toUpperCase()}: Foo`).prefix, prefix);
        }
        assert.equal(parseTag('Keen').prefix, null);
    });

    it('tolerates spacing around the prefix colon and strips only one prefix', () => {
        const parsed = parseTag('  Crit :  JOLT ');
        assert.equal(parsed.prefix, 'crit');
        assert.equal(parsed.body, 'JOLT');
        assert.equal(parsed.base, 'jolt');

        const nested = parseTag('Build: Detail: Fast');
        assert.equal(nested.prefix, 'build');
        assert.equal(nested.base, 'detail: fast');
    });

    it('detects the GM (Exempt) suffix and keeps the clean name', () => {
        const parsed = parseTag('Sharp (Exempt)');
        assert.equal(parsed.exempt, true);
        assert.equal(parsed.name, 'Sharp');
        assert.equal(parsed.base, 'sharp');
        assert.equal(parseTag('sharp (exempt)').exempt, true);
        // Only the trailing suffix marks exemption.
        assert.equal(parseTag('Exempted').exempt, false);
    });

    it('handles blanks and object-shaped tags', () => {
        assert.equal(parseTag('').base, '');
        assert.equal(parseTag('   ').name, '');
        assert.equal(parseTag(null).base, '');
        const fromObject = parseTag({ name: 'Keen', xp: 2 });
        assert.equal(fromObject.base, 'keen');
    });

    it('collapses whitespace and lowercases the base, preserving body casing', () => {
        const parsed = parseTag('Detail:   Very    Fast');
        assert.equal(parsed.base, 'very fast');
        assert.equal(parsed.body, 'Very    Fast');
    });
});

describe('parseTag structured bases', () => {
    it('parses Chain targets with original casing, including multi-word names', () => {
        assert.deepEqual(parseTag('Chain Helper').args, { target: 'Helper' });
        assert.equal(parseTag('Chain Helper').base, 'chain');
        assert.deepEqual(parseTag('Chain medical scanner').args, { target: 'medical scanner' });
        assert.deepEqual(parseTag('chain forge').args, { target: 'forge' });
        assert.deepEqual(parseTag('Chain').args, { target: '' });
    });

    it('keeps the prefix visible so the compiler can refuse prefixed chain links', () => {
        // compilePool only follows unprefixed chain tags; pricing still
        // sees base 'chain'. The parsed shape carries both facts.
        const parsed = parseTag('Build: Chain Sword Arm');
        assert.equal(parsed.prefix, 'build');
        assert.equal(parsed.base, 'chain');
        assert.equal(parsed.args.target, 'Sword Arm');
    });

    it('parses World links like free chains (p.63)', () => {
        const parsed = parseTag('World Helper');
        assert.equal(parsed.base, 'world');
        assert.deepEqual(parsed.args, { target: 'Helper' });
        assert.equal(parseTag('World').base, 'world');
    });

    it('parses Hitch values, clamping to the 1-6 rebate range (p.20)', () => {
        assert.deepEqual(parseTag('Hitch 3').args, { value: 3 });
        assert.deepEqual(parseTag('Hitch 0').args, { value: 1 });
        assert.deepEqual(parseTag('Hitch 9').args, { value: 6 });
        assert.deepEqual(parseTag('Flaw: Hitch 2').args, { value: 2 });
        assert.deepEqual(parseTag('Hitch').args, { value: null });
        assert.equal(DEFAULT_HITCH_VALUE, 3);
    });

    it('parses While forms with original casing (p.62)', () => {
        assert.deepEqual(parseTag('While Werewolf').args, { form: 'Werewolf' });
        assert.equal(parseTag('While Werewolf').base, 'while');
        const flawed = parseTag('Flaw: While Human');
        assert.equal(flawed.prefix, 'flaw');
        assert.deepEqual(flawed.args, { form: 'Human' });
    });

    it('parses the Motorized stat, uppercased (pp.29-31)', () => {
        assert.deepEqual(parseTag('Motorized: BODY').args, { stat: 'BODY' });
        assert.deepEqual(parseTag('Motorized: speed').args, { stat: 'SPEED' });
        assert.deepEqual(parseTag('motorized:power').args, { stat: 'POWER' });
        assert.deepEqual(parseTag('Motorized').args, { stat: '' });
    });

    it('parses the Bestial resource choice through the resource aliases (p.61)', () => {
        assert.deepEqual(parseTag('Bestial: HP').args, { resource: 'hp' });
        assert.deepEqual(parseTag('Bestial: Energy').args, { resource: 'en' });
        assert.deepEqual(parseTag('Detail: Bestial: Reflex').args, { resource: 'rx' });
        assert.deepEqual(parseTag('Bestial').args, { resource: '' });
        assert.deepEqual(parseTag('Bestial: Stamina').args, { resource: '' });
        assert.equal(parseTag('Celestial').base, 'celestial');
    });

    it('parses exact Crowd counts and leaves other crowd text unstructured (pp.51/79)', () => {
        assert.deepEqual(parseTag('Crowd 50').args, { count: 50 });
        assert.equal(parseTag('Crowd 50').base, 'crowd');
        const prefixed = parseTag('Range: Crowd 10');
        assert.equal(prefixed.prefix, 'range');
        assert.deepEqual(prefixed.args, { count: 10 });
        // Only the bare "crowd N" form is structured, matching getCrowdXp.
        assert.equal(parseTag('Crowd').base, 'crowd');
        assert.deepEqual(parseTag('Crowd').args, {});
        assert.equal(parseTag('Crowd 50 people').base, 'crowd 50 people');
    });

    it('splits Shield crit lists on spaces and commas (p.39, jousting plate p.40)', () => {
        assert.deepEqual(parseTag('Shield: JOLT').args.crits, ['jolt']);
        assert.deepEqual(parseTag('Shield: BREAK KO BLEED').args.crits, ['break', 'ko', 'bleed']);
        assert.deepEqual(parseTag('Shield: KO, BLEED').args.crits, ['ko', 'bleed']);
        const exempt = parseTag('Shield: DOWN (Exempt)');
        assert.equal(exempt.exempt, true);
        assert.deepEqual(exempt.args.crits, ['down']);
        // Crit-prefixed names stay single-base; no crits payload.
        assert.equal(parseTag('Crit: JOLT').base, 'jolt');
        assert.equal(parseTag('Crit: JOLT').args.crits, undefined);
    });

    it('leaves typos unstructured so the engine can flag them as unknown', () => {
        const parsed = parseTag('Sharrp');
        assert.equal(parsed.prefix, null);
        assert.equal(parsed.base, 'sharrp');
        assert.deepEqual(parsed.args, {});
        // The quirk inherited from getMechanicalBaseTag: startsWith matching
        // means "Hitchhiker" is still a hitch. Locked here on purpose.
        assert.equal(parseTag('Hitchhiker').base, 'hitch');
    });
});

describe('parseTags tile boundary', () => {
    it('accepts string arrays, legacy comma strings, and object tags', () => {
        const fromArray = parseTags({ tags: ['Keen', 'Hitch 3'] });
        assert.deepEqual(fromArray.map(parsed => parsed.base), ['keen', 'hitch']);

        const fromString = parseTags({ tags: 'Chain Helper, Sharp' });
        assert.deepEqual(fromString.map(parsed => parsed.base), ['chain', 'sharp']);
        assert.equal(fromString[0].args.target, 'Helper');

        const fromObjects = parseTags({ tags: [{ name: 'Keen', xp: 2 }, { name: '' }] });
        assert.deepEqual(fromObjects.map(parsed => parsed.base), ['keen']);
    });

    it('returns empty for missing tiles and empty tags', () => {
        assert.deepEqual(parseTags(null), []);
        assert.deepEqual(parseTags({}), []);
        assert.deepEqual(parseTags({ tags: '' }), []);
        assert.deepEqual(parseTags({ tags: [' ', ''] }), []);
    });

    it('memoizes and freezes parsed tags', () => {
        const first = parseTag('Keen');
        assert.equal(parseTag('Keen'), first);
        assert.ok(Object.isFrozen(first));
        assert.ok(Object.isFrozen(first.args));
    });
});

describe('serializeTag canonical forms and round-trips', () => {
    it('round-trips canonical strings exactly', () => {
        const canonical = [
            'Keen',
            'Build: Cyber',
            'Detail: Fast',
            'Crit: JOLT',
            'Shield: BREAK KO BLEED',
            'Flaw: While Human',
            'Range: Short',
            'Duration: Instant',
            'Chain medical scanner',
            'World Helper',
            'Hitch 3',
            'Hitch',
            'While Werewolf',
            'Motorized: SPEED',
            'Bestial: HP',
            'Crowd 50',
            'Sharp (Exempt)',
            'Shield: DOWN (Exempt)'
        ];
        for (const tag of canonical) {
            assert.equal(serializeTag(parseTag(tag)), tag, `round-trip ${tag}`);
        }
    });

    it('canonicalizes messy input', () => {
        assert.equal(serializeTag(parseTag('  build :  Chain   Sword Arm ')), 'Build: Chain Sword Arm');
        assert.equal(serializeTag(parseTag('flaw: hitch 2')), 'Flaw: Hitch 2');
        assert.equal(serializeTag(parseTag('motorized:power')), 'Motorized: POWER');
        assert.equal(serializeTag(parseTag('Bestial: Energy')), 'Bestial: EN');
        assert.equal(serializeTag(parseTag('Shield: Deflect')), 'Shield: DEFLECT');
        assert.equal(serializeTag(parseTag('sharp (exempt)')), 'sharp (Exempt)');
    });

    it('handles empty input', () => {
        assert.equal(serializeTag(null), '');
        assert.equal(serializeTag(parseTag('')), '');
    });
});

describe('parity with the pool.js helpers being replaced in PR 8', () => {
    it('matches getHitchValue across the clamp range', () => {
        for (const tags of [['Hitch 1'], ['Hitch 5'], ['Hitch 0'], ['Hitch 9'], ['Hitch'], ['Flaw: Hitch 4']]) {
            const tile = { tags };
            const parsed = parseTags(tile).find(tag => tag.base === 'hitch');
            assert.equal(parsed.args.value ?? DEFAULT_HITCH_VALUE, getHitchValue(tile), tags[0]);
        }
    });

    it('matches getTileWhileForms on build/detail/flaw-prefixed forms', () => {
        for (const tags of [['While Werewolf'], ['Flaw: While Human'], ['Detail: While Mist', 'Keen']]) {
            const tile = { tags };
            const forms = parseTags(tile)
                .filter(tag => tag.base === 'while')
                .map(tag => tag.args.form);
            assert.deepEqual(forms, getTileWhileForms(tile), tags.join(','));
        }
    });

    it('matches getTileShieldCrits including the multi-crit form', () => {
        const tile = { type: 'Gear', tags: ['Shield: JOLT', 'Shield: BREAK KO BLEED', 'Keen', 'DOWN'] };
        const crits = parseTags(tile)
            .filter(tag => tag.prefix === 'shield')
            .flatMap(tag => tag.args.crits);
        assert.deepEqual(crits, getTileShieldCrits(tile));
    });
});
