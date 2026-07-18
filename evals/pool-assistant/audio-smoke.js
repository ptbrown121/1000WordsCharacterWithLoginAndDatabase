// Small report-only corpus. The associated WAV files contain synthetic,
// non-sensitive readings of these commands so contributors can run the full
// audio path without committing a person's voice or personal information.
export const poolAssistantAudioSmokeCases = [
    { file: '01-sneak-normal.wav', caseId: 'case-01-1' },
    { file: '02-lock-fast.wav', caseId: 'case-02-2' },
    { file: '03-claws-normal.wav', caseId: 'case-03-1' },
    { file: '04-jump-fast.wav', caseId: 'case-04-2' },
    { file: '05-shoot-normal.wav', caseId: 'case-05-3' },
    { file: '06-first-aid-normal.wav', caseId: 'case-06-4' },
    { file: '07-burn-jump-fast.wav', caseId: 'case-08-2' },
    { file: '08-research-normal.wav', caseId: 'case-11-1' },
    { file: '09-arcana-fast.wav', caseId: 'case-12-3' },
    { file: '10-empathy-normal.wav', caseId: 'case-18-1' },
    { file: '11-repair-noisy.wav', caseId: 'case-23-3' },
    { file: '12-burn-repair-noisy.wav', caseId: 'case-25-4' },
    { file: '13-colors-sneak-normal.wav', caseId: 'case-01-1', expectsSpokenColors: true },
    { file: '14-stats-lock-fast.wav', caseId: 'case-02-2', expectsSpokenColors: true },
    { file: '15-colors-burn-normal.wav', caseId: 'case-08-2', expectsSpokenColors: true },
    { file: '16-colors-burn-fast.wav', caseId: 'case-25-4', expectsSpokenColors: true }
];
