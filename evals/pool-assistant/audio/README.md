# Pool assistant audio smoke fixtures

These sixteen short WAV files are synthetic, non-sensitive readings of cases
from the text evaluation corpus. Normal and fast readings exercise the upload,
transcription, and semantic-selection path. The two `noisy` fixtures contain a
quiet deterministic noise floor added to the generated speech.

Fixtures 13–16 explicitly speak the GM colors, using both color names and stat
names. Unlike the first twelve fallback cases, they must extract both colors
from the transcript before tile selection can run.

To rerun one fixture while tuning transcription hints, pass its filename:

```bash
npm run eval:pool-assistant:audio -- --file=16-colors-burn-fast.wav
```

They are report-only smoke coverage, not a statistically representative voice
benchmark. Before broad rollout, manually test real consenting speakers and a
noisy game-table environment without committing those recordings or raw audio.
For fast or noisy speech, saying the canonical color names is recommended;
stat-name aliases remain supported but are more vulnerable to transcription
errors such as BODY being heard as an ordinary word.

The generated WAV files are intentionally excluded from Git. This README, the
fixture manifest, evaluator, and deterministic text cases remain versioned;
contributors must supply or regenerate local WAV fixtures before running the
audio smoke command.
