# AI Pool Assistant rollout

The assistant is deliberately a preview-only convenience layer over the
existing pure pool-selection rules. The browser records at most 15 seconds or
sends at most 500 typed characters. The authenticated Vercel route transcribes
audio in memory, extracts the two colors explicitly stated by the GM (including
stat-name aliases such as MIND/Blue), then asks a selector model for matching
tiles. If the utterance has no colors, two colors already selected in the UI
are used as a fallback. The action is never used to infer colors. Every tile ID
and Call/Burn rule is validated, and one repair attempt is permitted. Only
confirmation replaces the transient Call colors, Call tile, and Burn tiles.
Canonical color names are recommended for fast or noisy speech because stat
names such as BODY can be misheard as ordinary words; unresolved pairs fail
safely instead of being guessed.

## Production gate

Keep `AI_POOL_ASSISTANT_ENABLED` unset or false until the live text evaluation
selects a model. A candidate passes only with all three results:

- at least 90 of 100 exact accepted tile selections for the supplied colors;
- 100 of 100 mechanically valid responses; and
- zero Burns on commands that did not explicitly request one.

Cases include spoken color-name and stat-name forms, direct tile requests,
action descriptions, genuine tile alternatives, explicit Burns, and
clarification cases. The exact gate requires one complete accepted tile/Burn
answer; diagnostic component scores do not award partial credit.

Run `npm run eval:pool-assistant` with `OPENAI_API_KEY` in a trusted local or CI
environment. Candidates are evaluated in estimated-cost order and the report
identifies the first passing model. The sixteen synthetic audio fixtures are
report-only; run `npm run eval:pool-assistant:audio`, then perform a consented
preview-environment check with real speakers and representative table noise.
Four fixtures explicitly speak color/stat pairs and cannot use the preselected
color fallback.

On July 18, 2026, `gpt-5.6-luna` with reasoning effort `none` passed the final
tile-focused confirmation suite at 98/100 exact, 100/100 mechanically valid,
100/100 correct Burn sets, and zero unexpected Burns. The selector portion used
127,272 input and 7,288 output tokens for an estimated $0.171 per 100 commands,
averaging 5.9 seconds per selection. Because Luna is a moving alias, this
establishes current viability but is not a permanently reproducible snapshot
result.

The companion synthetic audio smoke run completed all sixteen scenarios
exactly, including four of four cases that had to extract spoken color/stat
pairs without the preselected-color fallback. The final fast explicit-Burn
case correctly transcribed `Red and Blue`, called Engineering, and burned the
Jury-Rig Kit. This is sufficient for preview rollout, but the audio corpus
remains report-only and must be supplemented with consenting real speakers and
representative table noise before production rollout.

## Cost assumptions

The starting estimates assume a 10-second command, 3,000 selector input tokens,
150 selector output tokens, and no repair retry:

| Selector snapshot | Estimated total per 1,000 commands |
| --- | ---: |
| `gpt-5-nano-2025-08-07` | $0.71 |
| `gpt-4o-mini-2024-07-18` | $1.04 |
| `gpt-5.4-nano-2026-03-17` | $1.29 |
| `gpt-5-mini-2025-08-07` | $1.55 |
| `gpt-5.4-mini-2026-03-17` | $3.43 |
| `gpt-5.6-luna` | $4.40 |
| `gpt-5.6-terra` | $10.25 |

About $0.50 of each estimate is ten seconds of mini transcription per command.
Repairs increase selector cost, so use observed token usage from the live eval
before enabling production. `gpt-5.6-luna` is included because it is OpenAI's
new cost-sensitive GPT-5.6 tier, while `gpt-5.6-terra` is the more capable
mini-equivalent fallback; both support Structured Outputs and are evaluated
after cheaper models. GPT-5.6 Sol and GPT-5.5 are excluded because their
$5/$30 per-million-token pricing is disproportionate for this bounded selector.
As of July 18, 2026, OpenAI lists only moving Luna and Terra aliases rather
than date-pinned snapshots. Recheck current official
[API pricing](https://developers.openai.com/api/docs/pricing) before rollout.

## Environment variables

- `AI_POOL_ASSISTANT_ENABLED`: server-only kill switch; defaults to false.
- `OPENAI_POOL_ASSISTANT_MODEL`: defaults to the passing `gpt-5.6-luna` moving
  alias; override it when a cheaper candidate passes or a suitable snapshot is
  published.
- `OPENAI_POOL_TRANSCRIPTION_MODEL`: defaults to `gpt-4o-mini-transcribe`.
- `OPENAI_POOL_ASSISTANT_REASONING_EFFORT`: optional override; defaults to
  `minimal` for GPT-5 and `none` for GPT-5.4/5.6.
- `OPENAI_POOL_ASSISTANT_MAX_OUTPUT_TOKENS`: defaults to `1200`.
- `AI_RATE_LIMIT_REQUESTS` and `AI_RATE_LIMIT_WINDOW_SECONDS`: shared optional
  per-user AI rate limit.

Do not log raw audio. Monitor OpenAI usage and route error/rate-limit counts,
enable the flag in a preview environment first, and leave it disabled if no
candidate meets every production gate.
