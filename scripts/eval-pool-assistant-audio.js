import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
    getPoolAssistantReasoning,
    runPoolAssistantSelection,
    transcribePoolAssistantAudio
} from '../api/_lib/openaiPoolAssistant.js';
import { resolvePoolAssistantCallColors } from '../api/_lib/poolAssistant.js';
import { poolAssistantAudioSmokeCases } from '../evals/pool-assistant/audio-smoke.js';
import { characters, poolAssistantEvalCases } from '../evals/pool-assistant/cases.js';
import { buildPoolAssistantCharacter, matchesAcceptedPoolAssistantSelection } from '../js/pool-assistant.js';

if (!process.env.OPENAI_API_KEY) {
    process.stderr.write('OPENAI_API_KEY is required for the live audio smoke eval.\n');
    process.exit(2);
}

const model = process.env.OPENAI_POOL_ASSISTANT_MODEL || 'gpt-5.6-luna';
const corpusDirectory = new URL('../evals/pool-assistant/audio/', import.meta.url);
const results = [];
const requestedFile = process.argv.find(argument => argument.startsWith('--file='))?.slice('--file='.length);
const audioCases = requestedFile
    ? poolAssistantAudioSmokeCases.filter(audioCase => audioCase.file === requestedFile)
    : poolAssistantAudioSmokeCases;

if (audioCases.length === 0) {
    process.stderr.write(`Unknown audio fixture ${requestedFile}.\n`);
    process.exit(2);
}

for (const audioCase of audioCases) {
    const testCase = poolAssistantEvalCases.find(candidate => candidate.id === audioCase.caseId);
    if (!testCase) throw new Error(`Unknown eval case ${audioCase.caseId}.`);
    const character = buildPoolAssistantCharacter(characters[testCase.characterId]);
    try {
        const buffer = await readFile(new URL(audioCase.file, corpusDirectory));
        const transcriptionStartedAt = Date.now();
        const transcription = await transcribePoolAssistantAudio({ buffer, mimeType: 'audio/wav' }, character);
        const transcriptionLatencyMs = Date.now() - transcriptionStartedAt;
        const spokenCallColors = resolvePoolAssistantCallColors(transcription.transcript);
        const expectedColors = [...testCase.callColors].sort().join('|');
        const spokenColorsExact = [...spokenCallColors].sort().join('|') === expectedColors;
        const resolvedCallColors = resolvePoolAssistantCallColors(
            transcription.transcript,
            audioCase.expectsSpokenColors ? [] : testCase.callColors
        );
        const selectionStartedAt = Date.now();
        const selection = transcription.failed || resolvedCallColors.length !== 2 ? null : await runPoolAssistantSelection({
            commandText: transcription.transcript,
            character,
            callColors: resolvedCallColors,
            model
        });
        const selectionLatencyMs = selection ? Date.now() - selectionStartedAt : null;
        results.push({
            file: audioCase.file,
            expectedCommand: testCase.actionCommand,
            transcript: transcription.transcript,
            spokenCallColors,
            resolvedCallColors,
            expectsSpokenColors: Boolean(audioCase.expectsSpokenColors),
            spokenColorsExact: audioCase.expectsSpokenColors ? spokenColorsExact : null,
            usedPreselectedColorFallback: spokenCallColors.length === 0 && resolvedCallColors.length === 2,
            transcriptionFailed: transcription.failed,
            transcriptionLatencyMs,
            transcriptionUsage: transcription.usage || null,
            selectionFailed: selection?.failed ?? null,
            selectionLatencyMs,
            selectionUsage: selection?.usage || null,
            repaired: selection?.repaired || false,
            exactSelection: Boolean(selection?.result && matchesAcceptedPoolAssistantSelection(selection.result, testCase.acceptedSelections)),
            actualSelection: selection?.result || null,
            error: transcription.errorMessage
                || (resolvedCallColors.length !== 2 ? 'Could not resolve exactly two GM Call colors.' : '')
                || selection?.errorMessage
                || ''
        });
    } catch (error) {
        results.push({
            file: fileURLToPath(new URL(audioCase.file, corpusDirectory)),
            expectedCommand: testCase.actionCommand,
            transcript: '',
            spokenCallColors: [],
            resolvedCallColors: [],
            expectsSpokenColors: Boolean(audioCase.expectsSpokenColors),
            spokenColorsExact: audioCase.expectsSpokenColors ? false : null,
            usedPreselectedColorFallback: false,
            transcriptionFailed: true,
            transcriptionLatencyMs: null,
            transcriptionUsage: null,
            selectionFailed: null,
            selectionLatencyMs: null,
            selectionUsage: null,
            repaired: false,
            exactSelection: false,
            actualSelection: null,
            error: error instanceof Error ? error.message : 'Could not read audio fixture.'
        });
    }
}

process.stdout.write(`${JSON.stringify({
    reportOnly: true,
    model,
    reasoning: getPoolAssistantReasoning(model),
    transcribed: results.filter(result => !result.transcriptionFailed).length,
    completedSelections: results.filter(result => result.selectionFailed === false).length,
    exactSelections: results.filter(result => result.exactSelection).length,
    spokenColorCases: results.filter(result => result.expectsSpokenColors).length,
    exactSpokenColorExtractions: results.filter(result => result.expectsSpokenColors && result.spokenColorsExact).length,
    results
}, null, 2)}\n`);
