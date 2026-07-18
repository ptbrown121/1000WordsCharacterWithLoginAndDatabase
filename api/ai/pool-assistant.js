import { ApiError, handleApiError, readJson, requireMethod, sendJson } from '../_lib/http.js';
import { enforceAiRateLimit } from '../_lib/aiRateLimit.js';
import { runPoolAssistantSelection, transcribePoolAssistantAudio } from '../_lib/openaiPoolAssistant.js';
import {
    isPoolAssistantEnabled,
    parsePoolAssistantRequest,
    resolvePoolAssistantCallColors
} from '../_lib/poolAssistant.js';
import { requireUser } from '../_lib/supabase.js';

export function createPoolAssistantHandler({
    requireUserFn = requireUser,
    enforceRateLimitFn = enforceAiRateLimit,
    transcribeFn = transcribePoolAssistantAudio,
    selectFn = runPoolAssistantSelection
} = {}) {
    return async function handler(req, res) {
        try {
            requireMethod(req, ['GET', 'POST']);
            const enabled = isPoolAssistantEnabled();
            if (req.method === 'GET') {
                sendJson(res, 200, { enabled });
                return;
            }
            if (!enabled) throw new ApiError(404, 'The pool assistant is not enabled.');

            const { client } = await requireUserFn(req);
            const request = parsePoolAssistantRequest(await readJson(req));
            await enforceRateLimitFn(client);

            let transcript = request.commandText;
            let transcription = null;
            if (request.audio) {
                transcription = await transcribeFn(request.audio, request.character);
                if (transcription.failed) throw new ApiError(502, transcription.errorMessage || 'Audio transcription failed.');
                transcript = transcription.transcript;
            }

            const callColors = resolvePoolAssistantCallColors(transcript, request.callColors);
            if (callColors.length !== 2) {
                throw new ApiError(400, 'Say both GM Call colors, such as “Blue and Purple,” or select both colors first.');
            }

            const selection = await selectFn({
                commandText: transcript,
                character: request.character,
                callColors
            });
            if (selection.failed) throw new ApiError(502, selection.errorMessage || 'The pool assistant is unavailable.');

            sendJson(res, 200, {
                transcript,
                suggestion: selection.result,
                model: selection.model,
                repaired: selection.repaired,
                usage: {
                    transcription: transcription?.usage || null,
                    selection: selection.usage || null
                }
            });
        } catch (error) {
            handleApiError(res, error);
        }
    };
}

export default createPoolAssistantHandler();
