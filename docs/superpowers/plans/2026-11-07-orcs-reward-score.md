# Orcs Reward Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deterministic per-project score out of 100, recorded in a persistent history, used as the next project's target.

**Architecture:** Three new bash+jq scripts (`tokens.sh`, `score.sh`, target logic in `init-run.sh`) reading the run's existing artefacts plus Claude Code transcripts; weights and references in `knowledge/scoring.conf`; history in `scores/history.jsonl` of the Orcs source repo.

**Tech Stack:** bash, jq, git (unchanged). Plain-bash tests in `harness/tests/`.

**Spec:** `docs/superpowers/specs/2026-11-07-orcs-reward-score-design.md`

## Global Constraints
- No LLM anywhere in scoring. Same inputs → same score.
- Weights: correctness 35, process quality 20, satisfaction 20, tokens 10, speed 10, completion 5 (sum must be 100). Quality cap 60 when correctness < 1.
- Penalties: scope rejection 0.10, rework 0.05, escalation 0.05, blocker 0.03, budget breach 0.15.
- Refs default `REF_TOKENS_PER_BR=150000`, `REF_MINUTES_PER_BR=15`. Effective tokens = input + output + cache_creation + 0.1 × cache_read, de-duplicated by message id.
- Run window: trace `started_at` → latest test-report approval. Harness time excludes matched `owner_wait_start`/`owner_wait_end` pairs.
- Score is `pending` (no history line) until `SATISFACTION: n/10` (integer 0–10) is in the latest project section of the observer report.

## Review Focus
- **Duplicate transcript lines for one message** → counted once (Task 2).
- **Transcript activity outside the run window** → excluded (Task 2).
- **A failing approved BR-ID with perfect efficiency** → score ≤ 60 (Task 3).
- **Scoring the same run twice** → refused without `--rescore` (Task 3).
- **Malformed satisfaction line (`SATISFACTION: great`, `11/10`)** → stays pending, never guessed (Task 3).

---

### Task 1: Config, trace fields, run start time
**Files:** Create `knowledge/scoring.conf`, `scores/.gitkeep`. Modify `harness/lib/common.sh` (`load_scoring_conf`, `scores_file`), `harness/trace.sh`, `harness/validate-contract.sh`, `contracts/execution-trace.schema.json`, `harness/init-run.sh` (`started_at`). Tests: `trace_test.sh`, `init-run_test.sh`.
- [ ] RED: trace accepts `owner_wait_start`/`owner_wait_end`; init-run trace has ISO `started_at`; `load_scoring_conf` rejects weights not summing to 100.
- [ ] GREEN, suite, commit.

### Task 2: `tokens.sh <project-dir> <start-iso> <end-iso>`
**Files:** Create `harness/tokens.sh`, `harness/tests/tokens_test.sh`. Transcript root `${ORCS_TRANSCRIPTS_ROOT:-$HOME/.claude/projects}`, slug = project path with every non-alphanumeric → `-`; reads `<slug>/*.jsonl` and `<slug>/*/subagents/*.jsonl`. Prints JSON `{input,output,cache_creation,cache_read,effective,messages}`.
- [ ] RED: duplicates counted once; out-of-window excluded; subagent files included; missing dir fails loud.
- [ ] GREEN, suite, commit.

### Task 3: `score.sh <task-dir> [--rescore]`
**Files:** Create `harness/score.sh`, `harness/tests/score_test.sh`. Writes `<task-dir>/score.json`; appends history on final.
- [ ] RED: perfect run = 100; one failing BR → ≤ 60; penalties reduce quality exactly; owner-wait excluded from speed; pending without satisfaction (no history line); malformed satisfaction pending; second scoring refused; `--rescore` appends; tampered approved contract refused.
- [ ] GREEN, suite, commit.

### Task 4: Pre-project target in `init-run.sh`
**Files:** Modify `harness/init-run.sh`; test `init-run_test.sh`.
- [ ] RED: no history → "baseline" message, target.json `beat:null`; with history → `beat` = latest score, `best` = max, `focus` = factor with the largest weighted gap.
- [ ] GREEN, suite, commit.

### Task 5: Docs + agents + skill + apply
**Files:** `agents/task-observer.md` (`### Score`, `SATISFACTION:` line, focus on weakest factor), `skills/orcs-pipeline/skill.md` (owner-wait tracing, target at start, score step), `readme.md`, `executions/README.md`.
- [ ] Update; grep checks; suite; commit; reinstall globally; whole-branch review of the score range.
