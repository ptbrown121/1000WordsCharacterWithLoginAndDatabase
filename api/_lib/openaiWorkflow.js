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

async function createStructuredResponse({ model, input, schema, name, reasoningEffort }) {
    const client = getOpenAI();
    if (!client) return null;

    const response = await client.responses.create({
        model,
        input,
        text: { format: responseFormat(name, schema) },
        reasoning: { effort: reasoningEffort },
        max_output_tokens: 1600
    });

    return {
        raw: response,
        parsed: parseJsonOutput(extractOutputText(response), null),
        usage: response.usage || null
    };
}

export async function runSceneAgent(payload) {
    const model = process.env.OPENAI_SCENE_MODEL || 'gpt-5.4-mini';
    const fallback = defaultSceneResponse(payload.playerMessage);

    try {
        const response = await createStructuredResponse({
            model,
            input: buildSceneAgentInput(payload),
            schema: sceneResponseSchema,
            name: 'character_creation_scene_turn',
            reasoningEffort: process.env.OPENAI_SCENE_REASONING_EFFORT || 'low'
        });

        if (!response?.parsed) return { result: fallback, model: 'local-fallback', usedFallback: true, usage: null };
        return {
            result: {
                ...fallback,
                ...response.parsed,
                tile_suggestions: normalizeTileSuggestions(response.parsed.tile_suggestions)
            },
            model,
            usedFallback: false,
            usage: response.usage
        };
    } catch (error) {
        console.error('Scene agent failed', error);
        return { result: fallback, model, usedFallback: true, usage: null, error };
    }
}

export async function runSummaryAgent(payload) {
    const model = process.env.OPENAI_ORCHESTRATOR_MODEL || 'gpt-5.5';
    const fallback = defaultSummary(payload.messages);

    try {
        const response = await createStructuredResponse({
            model,
            input: buildSummaryAgentInput(payload),
            schema: summaryResponseSchema,
            name: 'character_creation_scene_summary',
            reasoningEffort: process.env.OPENAI_ORCHESTRATOR_REASONING_EFFORT || 'medium'
        });

        if (!response?.parsed) return { result: fallback, model: 'local-fallback', usedFallback: true, usage: null };
        return {
            result: {
                ...fallback,
                ...response.parsed,
                tile_suggestions: normalizeTileSuggestions(response.parsed.tile_suggestions)
            },
            model,
            usedFallback: false,
            usage: response.usage
        };
    } catch (error) {
        console.error('Summary agent failed', error);
        return { result: fallback, model, usedFallback: true, usage: null, error };
    }
}

export async function runValidationAgent(payload) {
    const model = process.env.OPENAI_VALIDATOR_MODEL || process.env.OPENAI_ORCHESTRATOR_MODEL || 'gpt-5.5';
    const fallback = defaultValidation();

    try {
        const response = await createStructuredResponse({
            model,
            input: buildValidationAgentInput(payload),
            schema: validationResponseSchema,
            name: 'character_creation_scene_validation',
            reasoningEffort: process.env.OPENAI_VALIDATOR_REASONING_EFFORT || 'medium'
        });

        if (!response?.parsed) return { result: fallback, model: 'local-fallback', usedFallback: true, usage: null };
        return {
            result: {
                ...fallback,
                ...response.parsed,
                status: response.parsed.status === 'needs_revision' ? 'needs_revision' : 'valid'
            },
            model,
            usedFallback: false,
            usage: response.usage
        };
    } catch (error) {
        console.error('Validation agent failed', error);
        return { result: fallback, model, usedFallback: true, usage: null, error };
    }
}
