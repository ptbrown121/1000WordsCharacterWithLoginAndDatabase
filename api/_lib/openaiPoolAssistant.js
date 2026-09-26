import OpenAI, { toFile } from 'openai';
import { extractOutputText, parseJsonOutput } from './aiWorkflow.js';
import {
    buildPoolAssistantInput,
    poolAssistantResponseSchema,
    transcriptionPrompt,
    validatePoolAssistantAgentResult
} from './poolAssistant.js';

let openaiClient = null;
export const DEFAULT_POOL_ASSISTANT_MAX_OUTPUT_TOKENS = 1200;

function getOpenAI() {
    if (!process.env.OPENAI_API_KEY) return null;
    if (!openaiClient) openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return openaiClient;
}

function responseFormat() {
    return {
        type: 'json_schema',
        name: 'pool_assistant_selection',
        strict: true,
        schema: poolAssistantResponseSchema
    };
}

export function getPoolAssistantReasoning(model, environment = process.env) {
    if (/^gpt-4o/i.test(model)) return null;
    const override = String(environment.OPENAI_POOL_ASSISTANT_REASONING_EFFORT || '').trim();
    if (override) return { effort: override };
    if (/^gpt-5\.(4|6)/i.test(model)) return { effort: 'none' };
    if (/^gpt-5(?:-|$)/i.test(model)) return { effort: 'minimal' };
    return { effort: 'low' };
}

function addUsage(left, right) {
    if (!left) return right || null;
    if (!right) return left;
    return {
        input_tokens: (left.input_tokens || 0) + (right.input_tokens || 0),
        output_tokens: (left.output_tokens || 0) + (right.output_tokens || 0),
        total_tokens: (left.total_tokens || 0) + (right.total_tokens || 0)
    };
}

async function createSelectionResponse(client, { commandText, character, callColors, model, repair }) {
    const request = {
        model,
        input: buildPoolAssistantInput(commandText, character, callColors, repair),
        text: { format: responseFormat() },
        max_output_tokens: Number.parseInt(process.env.OPENAI_POOL_ASSISTANT_MAX_OUTPUT_TOKENS || '', 10)
            || DEFAULT_POOL_ASSISTANT_MAX_OUTPUT_TOKENS
    };
    const reasoning = getPoolAssistantReasoning(model);
    if (reasoning) request.reasoning = reasoning;
    const response = await client.responses.create(request);
    return {
        parsed: parseJsonOutput(extractOutputText(response), null),
        usage: response.usage || null,
        incompleteReason: response.status === 'incomplete' ? response.incomplete_details?.reason || 'incomplete' : ''
    };
}

export async function transcribePoolAssistantAudio(audio, character, model = process.env.OPENAI_POOL_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe') {
    const client = getOpenAI();
    if (!client) return { failed: true, errorMessage: 'OPENAI_API_KEY is not configured.', transcript: '', model, usage: null };
    try {
        const extension = audio.mimeType === 'audio/mp4' ? 'mp4'
            : audio.mimeType === 'audio/mpeg' ? 'mp3'
                : audio.mimeType === 'audio/wav' ? 'wav' : 'webm';
        const file = await toFile(audio.buffer, `pool-command.${extension}`, { type: audio.mimeType });
        const result = await client.audio.transcriptions.create({
            file,
            model,
            language: 'en',
            prompt: transcriptionPrompt(character),
            response_format: 'json'
        });
        const transcript = typeof result === 'string' ? result.trim() : String(result?.text || '').trim();
        if (!transcript) return { failed: true, errorMessage: 'The audio did not contain a usable command.', transcript: '', model, usage: result?.usage || null };
        return { failed: false, errorMessage: '', transcript, model, usage: result?.usage || null };
    } catch (error) {
        console.error('Pool assistant transcription failed', error);
        return { failed: true, errorMessage: 'Audio transcription failed.', transcript: '', model, usage: null };
    }
}

export async function runPoolAssistantSelection({ commandText, character, callColors, model = process.env.OPENAI_POOL_ASSISTANT_MODEL || 'gpt-5.6-luna' }) {
    const client = getOpenAI();
    if (!client) return { failed: true, errorMessage: 'OPENAI_API_KEY is not configured.', result: null, model, usage: null, repaired: false };
    try {
        const first = await createSelectionResponse(client, { commandText, character, callColors, model, repair: null });
        if (!first.parsed) {
            return { failed: true, errorMessage: first.incompleteReason ? `The selection response was incomplete (${first.incompleteReason}).` : 'The selection response was not valid JSON.', result: null, model, usage: first.usage, repaired: false };
        }
        const firstValidation = validatePoolAssistantAgentResult(first.parsed, character, callColors);
        if (firstValidation.valid) {
            return { failed: false, errorMessage: '', result: firstValidation.suggestion, model, usage: first.usage, repaired: false };
        }

        const second = await createSelectionResponse(client, {
            commandText,
            character,
            callColors,
            model,
            repair: { errors: firstValidation.errors, previous: firstValidation.suggestion }
        });
        const combinedUsage = addUsage(first.usage, second.usage);
        if (!second.parsed) {
            return { failed: true, errorMessage: 'The assistant could not repair an invalid selection.', result: null, model, usage: combinedUsage, repaired: true };
        }
        const secondValidation = validatePoolAssistantAgentResult(second.parsed, character, callColors);
        if (!secondValidation.valid) {
            console.error('Pool assistant returned invalid selections twice', secondValidation.errors);
            return { failed: true, errorMessage: 'The assistant could not produce a mechanically valid selection.', result: null, model, usage: combinedUsage, repaired: true };
        }
        return { failed: false, errorMessage: '', result: secondValidation.suggestion, model, usage: combinedUsage, repaired: true };
    } catch (error) {
        console.error('Pool assistant selection failed', error);
        return { failed: true, errorMessage: 'Pool selection failed.', result: null, model, usage: null, repaired: false };
    }
}
