import OpenAI from 'openai';
import {
    buildSceneAgentInput,
    buildSummaryAgentInput,
    buildValidationAgentInput,
    defaultSceneResponse,
    defaultSummary,
    defaultValidation,
    extractOutputText,
    normalizeTileSuggestions,
    parseJsonOutput,
    sceneResponseSchema,
    summaryResponseSchema,
    validationResponseSchema
} from './aiWorkflow.js';

let openaiClient = null;

function getOpenAI() {
    if (!process.env.OPENAI_API_KEY) return null;
    if (!openaiClient) openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return openaiClient;
}

function responseFormat(name, schema) {
    return {
        type: 'json_schema',
        name,
        strict: true,
        schema
    };
}

export function resolveMaxOutputTokens(envName, fallback) {
    const value = Number.parseInt(process.env[envName] || '', 10);
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function describeStructuredFailure(incompleteReason, maxOutputTokens) {
    if (incompleteReason === 'max_output_tokens') {
        return `The model ran out of output budget (${maxOutputTokens} tokens, shared with reasoning) before finishing its reply.`;
    }
    if (incompleteReason) return `The model response was incomplete (${incompleteReason}).`;
    return 'The model returned output that could not be parsed as the expected JSON.';
}

// Shared driver for the three structured-output agents. Returns:
// - usedFallback: true  -> no API key configured; deterministic local result.
// - failed: true        -> a key is configured but the call errored or produced
//                          unusable output. Callers must surface this to the
//                          player and log it instead of saving canned content.
async function runStructuredAgent({ agentLabel, model, input, schema, schemaName, reasoningEffort, maxOutputTokens, fallback, normalize = parsed => parsed }) {
    const client = getOpenAI();
    if (!client) {
        return { result: fallback, model: 'local-fallback', usedFallback: true, failed: false, errorMessage: '', usage: null };
    }

    try {
        const response = await client.responses.create({
            model,
            input,
            text: { format: responseFormat(schemaName, schema) },
            reasoning: { effort: reasoningEffort },
            max_output_tokens: maxOutputTokens
        });
        const parsed = parseJsonOutput(extractOutputText(response), null);
        const usage = response.usage || null;

        if (!parsed) {
            const incompleteReason = response.status === 'incomplete'
                ? (response.incomplete_details?.reason || 'incomplete')
                : '';
            const errorMessage = describeStructuredFailure(incompleteReason, maxOutputTokens);
            console.error(`${agentLabel} agent returned unusable output`, { model, incompleteReason });
            return { result: null, model, usedFallback: false, failed: true, errorMessage, usage };
        }

        return { result: normalize(parsed, fallback), model, usedFallback: false, failed: false, errorMessage: '', usage };
    } catch (error) {
        console.error(`${agentLabel} agent failed`, error);
        return {
            result: null,
            model,
            usedFallback: false,
            failed: true,
            errorMessage: error?.message || 'OpenAI request failed.',
            usage: null
        };
    }
}

export async function runSceneAgent(payload) {
    return runStructuredAgent({
        agentLabel: 'Scene',
        model: process.env.OPENAI_SCENE_MODEL || 'gpt-5.4-mini',
        input: buildSceneAgentInput(payload),
        schema: sceneResponseSchema,
        schemaName: 'character_creation_scene_turn',
        reasoningEffort: process.env.OPENAI_SCENE_REASONING_EFFORT || 'low',
        maxOutputTokens: resolveMaxOutputTokens('OPENAI_SCENE_MAX_OUTPUT_TOKENS', 2500),
        fallback: defaultSceneResponse(payload.playerMessage),
        normalize: (parsed, fallback) => ({
            ...fallback,
            ...parsed,
            tile_suggestions: normalizeTileSuggestions(parsed.tile_suggestions)
        })
    });
}

export async function runSummaryAgent(payload) {
    return runStructuredAgent({
        agentLabel: 'Summary',
        model: process.env.OPENAI_ORCHESTRATOR_MODEL || 'gpt-5.5',
        input: buildSummaryAgentInput(payload),
        schema: summaryResponseSchema,
        schemaName: 'character_creation_scene_summary',
        reasoningEffort: process.env.OPENAI_ORCHESTRATOR_REASONING_EFFORT || 'medium',
        maxOutputTokens: resolveMaxOutputTokens('OPENAI_ORCHESTRATOR_MAX_OUTPUT_TOKENS', 6000),
        fallback: defaultSummary(payload.messages),
        normalize: (parsed, fallback) => ({
            ...fallback,
            ...parsed,
            tile_suggestions: normalizeTileSuggestions(parsed.tile_suggestions)
        })
    });
}

export async function runValidationAgent(payload) {
    return runStructuredAgent({
        agentLabel: 'Validation',
        model: process.env.OPENAI_VALIDATOR_MODEL || process.env.OPENAI_ORCHESTRATOR_MODEL || 'gpt-5.5',
        input: buildValidationAgentInput(payload),
        schema: validationResponseSchema,
        schemaName: 'character_creation_scene_validation',
        reasoningEffort: process.env.OPENAI_VALIDATOR_REASONING_EFFORT || 'medium',
        maxOutputTokens: resolveMaxOutputTokens('OPENAI_VALIDATOR_MAX_OUTPUT_TOKENS', 4000),
        fallback: defaultValidation(),
        normalize: (parsed, fallback) => ({
            ...fallback,
            ...parsed,
            status: parsed.status === 'needs_revision' ? 'needs_revision' : 'valid'
        })
    });
}
