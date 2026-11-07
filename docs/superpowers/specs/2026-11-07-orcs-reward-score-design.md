# Orcs Reward Score — Design

**Date:** 2026-11-07 · **Status:** Draft for approval · **Extends:** `2026-11-07-orcs-harness-design.md`

## Intent
After every project, Orcs computes a **score out of 100** with deterministic code (no LLM),
records it, and starts the next project with that score as the bar to beat. The aim is to
make the harness faster and leaner over time **without compromising delivery quality**.

## Goals / non-goals / anti-goals
- **Goals:** a reproducible score from recorded run data; a persistent score history; a
  pre-project target ("beat N; weakest factor X"); improvement driven through the existing
  owner-approved upskill loop.
- **Non-goals:** live cost in dollars; ranking of individual agents.
- **Anti-goals:** a score that rewards cutting corners (skipping research or tests), splitting
  work into more tasks, or the owner answering faster; any LLM-chosen number.

## Factors and weights (sum = 100)

| Factor | Weight | Deterministic source | Value 0..1 |
|---|---|---|---|
| Correctness | 35 | `test-report.approved.json` | approved BR-IDs with PASS ÷ approved BR-IDs |
| Process quality (the "observer score") | 20 | `integration.json`, `execution-trace.json`, `budgets.json` | `max(0, 1 − penalties)` — see below |
| Owner satisfaction | 20 | `SATISFACTION: n/10` line in the observer report | n ÷ 10 |
| Token efficiency | 10 | Claude Code transcripts (`~/.claude/projects/<project>/**/*.jsonl`) | `min(1, ref_tokens_per_BR ÷ actual_tokens_per_BR)` |
| Delivery speed | 10 | trace timestamps + owner-wait events | `min(1, ref_minutes_per_BR ÷ actual_harness_minutes_per_BR)` |
| Completion ("tasks done") | 5 | `integration.json` vs approved architecture | micro-tasks merged ÷ micro-tasks planned |

**Process-quality penalties** (each occurrence): scope-gate or scope-audit rejection 0.10 ·
other integration failure (rework) 0.05 · escalation 0.05 · developer blocker 0.03 ·
budget breach 0.15. The task observer *explains* this number; it never sets it.

**Quality gate:** if Correctness < 1 (any approved BR-ID not passing), the final score is
capped at **60** — efficiency can never buy back missed scope. A score is `pending` until the
owner records satisfaction.

**Normalisation:** tokens and time are measured **per approved BR-ID**, so projects of
different sizes are comparable. Reference values live in `knowledge/scoring.conf`
(defaults `REF_TOKENS_PER_BR=150000`, `REF_MINUTES_PER_BR=15`); 100 means every factor met
its reference. The owner tunes references; changing them is an approved upskill change, and
each history record stores the references and weights it used.

**Token count:** effective tokens = `input + output + cache_creation + 0.1 × cache_read`,
summed over the main session's and subagents' transcripts for the project directory, within
the run window, de-duplicated by message id (a streamed message appears once per block).

**Run window & speed:** from `init-run.sh` (run start) to the test-report approval (delivery
complete). Harness time = window − owner-wait time, where the orchestrator traces
`owner_wait_start` / `owner_wait_end` around every question relay and contract review.
Unmatched or missing wait events count as harness time (conservative).

## Records and targets
- `harness/score.sh <task-dir>` writes `executions/<id>/score.json` (every input, factor, and
  the final score) and appends one line to `scores/history.jsonl` in the Orcs source repo
  (survives reinstalls, versioned in git). Re-scoring the same run replaces nothing; it is
  refused unless `--rescore`, which appends a superseding record.
- `init-run.sh` prints the last score, the best score, the weakest factor, and writes
  `executions/<id>/target.json` (`beat`: last score, `focus`: weakest factor).
- The task observer's report gains a `### Score` section (pasted from `score.sh`) and aims
  its proposals at the weakest factor. Agents are not told to cut tokens or time — they still
  follow the engineering principles; the quality gate makes corner-cutting a losing move.

## Approaches considered
- **Absolute references (chosen):** comparable across projects, "100" is meaningful,
  owner-tunable.
- **Relative to the previous project:** the first project trivially scores 100 on
  efficiency and size swings dominate. Rejected.
- **LLM observer judgement for process quality:** not deterministic. Rejected.

## Left to the builder
Exact jq for the transcript parse, the project-dir slug rule, the history line format,
and how `--rescore` marks superseded records.
