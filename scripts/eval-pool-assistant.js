import { poolAssistantEvalCases, characters } from '../evals/pool-assistant/cases.js';
import { getPoolAssistantReasoning, runPoolAssistantSelection } from '../api/_lib/openaiPoolAssistant.js';
import { resolvePoolAssistantCallColors } from '../api/_lib/poolAssistant.js';
import {
    buildPoolAssistantCharacter,
    getPoolAssistantSelectionMatch,
    validatePoolAssistantSuggestion
} from '../js/pool-assistant.js';

const CANDIDATES = [
    { model: 'gpt-5-nano-2025-08-07', inputPrice: 0.05, outputPrice: 0.40 },
    { model: 'gpt-4o-mini-2024-07-18', inputPrice: 0.15, outputPrice: 0.60 },
    { model: 'gpt-5.4-nano-2026-03-17', inputPrice: 0.20, outputPrice: 1.25 },
    { model: 'gpt-5-mini-2025-08-07', inputPrice: 0.25, outputPrice: 2.00 },
    { model: 'gpt-5.4-mini-2026-03-17', inputPrice: 0.75, outputPrice: 4.50 },
    // OpenAI currently publishes only moving aliases for the GPT-5.6 tiers,
    // so report that these results are not reproducible pinned snapshots.
    { model: 'gpt-5.6-luna', inputPrice: 1.00, outputPrice: 6.00, pinned: false },
    { model: 'gpt-5.6-terra', inputPrice: 2.50, outputPrice: 15.00, pinned: false }
];

const requestedModel = process.argv.find(argument => argument.startsWith('--model='))?.slice('--model='.length);
const candidates = requestedModel
    ? CANDIDATES.filter(candidate => candidate.model === requestedModel)
    : CANDIDATES;

if (!process.env.OPENAI_API_KEY) {
    process.stderr.write('OPENAI_API_KEY is required for the live pool-assistant eval.\n');
    process.exit(2);
}
if (candidates.length === 0) {
    process.stderr.write(`Unknown model ${requestedModel}.\n`);
    process.exit(2);
}

function usageTokens(usage, key) {
    return Number(usage?.[key] || 0);
}

async function evaluateCase(testCase, candidate) {
    const character = buildPoolAssistantCharacter(characters[testCase.characterId]);
    const callColors = resolvePoolAssistantCallColors(testCase.command);
    const startedAt = Date.now();
    const response = await runPoolAssistantSelection({
        commandText: testCase.command,
        character,
        callColors,
        model: candidate.model
    });
    const latencyMs = Date.now() - startedAt;
    const validation = response.result
        ? validatePoolAssistantSuggestion(response.result, character.tiles)
        : { valid: false, errors: [response.errorMessage || 'No result'] };
    const match = response.result
        ? getPoolAssistantSelectionMatch(response.result, testCase.acceptedSelections)
        : { exact: false, status: false, callColors: false, callTile: false, burns: false };
    const unexpectedBurn = !testCase.explicitlyRequestsBurn && (response.result?.burnTileIds?.length || 0) > 0;
    return {
        id: testCase.id,
        exact: match.exact,
        matches: match,
        mechanicallyValid: validation.valid,
        unexpectedBurn,
        latencyMs,
        inputTokens: usageTokens(response.usage, 'input_tokens'),
        outputTokens: usageTokens(response.usage, 'output_tokens'),
        repaired: response.repaired,
        error: response.failed ? response.errorMessage : '',
        actual: response.result
    };
}

async function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;
    async function worker() {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await mapper(items[index]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    return results;
}

const reports = [];
for (const candidate of candidates) {
    process.stderr.write(`Evaluating ${candidate.model} across ${poolAssistantEvalCases.length} cases…\n`);
    const cases = await mapWithConcurrency(poolAssistantEvalCases, 5, testCase => evaluateCase(testCase, candidate));
    const exactPasses = cases.filter(result => result.exact).length;
    const validPasses = cases.filter(result => result.mechanicallyValid).length;
    const unexpectedBurns = cases.filter(result => result.unexpectedBurn).length;
    const statusPasses = cases.filter(result => result.matches.status).length;
    const callTilePasses = cases.filter(result => result.matches.callTile).length;
    const burnPasses = cases.filter(result => result.matches.burns).length;
    const inputTokens = cases.reduce((sum, result) => sum + result.inputTokens, 0);
    const outputTokens = cases.reduce((sum, result) => sum + result.outputTokens, 0);
    const estimatedCost = (inputTokens / 1_000_000 * candidate.inputPrice)
        + (outputTokens / 1_000_000 * candidate.outputPrice);
    const report = {
        model: candidate.model,
        pinnedSnapshot: candidate.pinned !== false,
        reasoning: getPoolAssistantReasoning(candidate.model),
        exactPasses,
        exactRate: exactPasses / cases.length,
        componentPasses: {
            status: statusPasses,
            callTile: callTilePasses,
            burns: burnPasses
        },
        mechanicallyValid: validPasses,
        unexpectedBurns,
        averageLatencyMs: Math.round(cases.reduce((sum, result) => sum + result.latencyMs, 0) / cases.length),
        inputTokens,
        outputTokens,
        estimatedCostUsd: Number(estimatedCost.toFixed(6)),
        passedGate: exactPasses >= 90 && validPasses === cases.length && unexpectedBurns === 0,
        failures: cases.filter(result => !result.exact || !result.mechanicallyValid || result.unexpectedBurn)
    };
    reports.push(report);
    process.stderr.write(`${candidate.model}: ${exactPasses}/100 exact, ${validPasses}/100 valid, ${unexpectedBurns} unexpected Burns.\n`);
}

const selected = reports.find(report => report.passedGate)?.model || null;
process.stdout.write(`${JSON.stringify({ selectedModel: selected, reports }, null, 2)}\n`);
process.exitCode = selected ? 0 : 1;
