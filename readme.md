# Orcs — a model-invariant delivery harness for Claude Code

Orcs turns a requirement into a tested solution through specialist Claude Code agents.
It is a **harness**, not a pipeline: the agents are intelligent, but the harness is
authoritative. Rules that matter — scope, stage order, approvals, budgets — are enforced by
scripts and a Claude Code hook, not by asking a model nicely.

**Goal:** whatever model you choose, you get *exactly what you asked for* — after proper
research, with nothing assumed and nothing extra. A strong model cannot add unrequested
features; a weak model cannot silently skip a requirement. When a task is beyond the
model, the harness stops and reports the gap instead of guessing.

```
 Owner ──► Orchestrator (your main Claude Code session)
              │ relays questions · shows you every contract · runs the gates
              ▼
 Analyst ─► Architect ─► micro-task DAG ─► Developer ×N (parallel, git worktrees)
 (asks)     (asks)                              │  never ask — return a blocker
                                                ▼
                         Integration manager: scope gate → scope auditor → lint
                                              → unit tests → merge → integration tests
                                                ▼
                                         Tester (once, independent) ─► Task Observer
                                         (flaws only)                  (report + your
                                                                        feedback → upskill)
```

## How it works

- **Contracts, not prose handoffs.** Each stage writes a JSON contract
  (`contracts/*.schema.json`) into `executions/<task-id>/`. Every requirement has a BR-ID
  and acceptance criteria; every change must map to an approved BR-ID.
- **You review every contract.** Requirement, architecture (each micro-task, including its
  `complexity`), and test report are shown to you before the next agent runs. Nothing
  advances without your explicit approval (`approve.sh` freezes the approved copy).
- **Question rights by role.** Analyst and architect may ask (relayed by the main session —
  subagents cannot prompt you). Developers never ask; they return a blocker. The tester asks
  only about business-requirement flaws.
- **Parallel developers, one tester.** The architect decomposes the design into micro-tasks
  with disjoint file ownership. Up to three developers build in parallel, each in its own git
  worktree. The integration manager merges only branches that pass every gate; then one
  independent tester verifies the integrated product.
- **Independent testing.** The tester designs cases from the requirements and design (never
  from the developers' code) using the fixed `knowledge/TESTING_GUIDELINES.md`, with full
  BR-ID traceability.
- **Fast-path for small tasks.** `complexity: low` skips the DAG fan-out (one developer) but
  never the scope gate, auditor, or tester. A trip-wire escalates a mislabelled task.
- **Budgets and fail-loud.** Iterations, fix cycles, and retries are capped; on a breach the
  run stops, keeps its state, and reports.
- **Gets smarter every project.** The task observer measures each run from its contracts and
  execution trace, finds root causes, and proposes changes to Orcs's own agents, knowledge,
  and gates. You comment in the report's `### User Feedback` block and approve in
  `### Owner Approval`; only approved changes are staged — committed to this repo, versioned.

## The gates

| Gate | Script (`harness/`) |
|---|---|
| Contract shape, BR-ID uniqueness, traceability | `validate-contract.sh` |
| Stage order — no agent without its approved inputs | `hooks/block-stage-advance.sh` (PreToolUse hook) |
| File-level scope | `scope-gate.sh` |
| Behaviour-level scope (independent auditor) | `scope-audit.sh` + `scope-auditor/PROMPT.md` |
| Disjoint parallel work | `dag-ready.sh` |
| Integration (scope → audit → lint → tests → merge) | `integration.sh` |
| Budgets / fast-path escalation | `budgets.sh` / `complexity-tripwire.sh` |
| Owner approval (sha256-locked) / upskill (approved proposals only) | `approve.sh` / `upskill-apply.sh` |
| Developer worktree + in-flight tracking | `dev-worktree.sh` |

The gates need only `bash`, `jq`, and `git`. Run their tests with `bash harness/tests/run.sh`.

## The skills

Six official community skills, installed globally:

| Skill | Role in the harness | Source |
|---|---|---|
| **superpowers** | research before deciding (analyst, architect, every stage) | `obra/superpowers-marketplace` |
| **find-skills** | per-stage task skills, installed project-level with your approval | `vercel-labs/skills` |
| **caveman** | terse prose in chat and companion docs (never code or contracts) | `JuliusBrussee/caveman` |
| **claude-mem** | human-readable companion docs beside each JSON contract | `thedotmack/claude-mem` |
| **impeccable** | every frontend task — no AI slop | `pbakaus/impeccable` |
| **task-observer** | observation log + the per-project upskill loop | `rebelytics/one-skill-to-rule-them-all` |

Plus the in-repo **`orcs-pipeline`** skill — the harness contract the orchestrator and every
agent load first.

## Running a project

In your project, in a Claude Code session:

1. `bash ~/.claude/orcs/harness/init-run.sh ORCS-001` — starts the run.
2. Tell the session your requirement and that you want to run it through Orcs. The main
   session follows the `orcs-pipeline` skill: dispatches the analyst, relays its questions,
   shows you the requirement contract, and so on through every stage.
3. Approve (or flag) each contract when asked. Answer blockers and flaws.
4. At the end, read `docs/07-observer-report.md`, add your comments under
   `### User Feedback`, and write `APPROVED: <numbers>` (or `APPROVED: none`).

## Install

```bash
# macOS / Linux
git clone <this-repo> && cd orcs
./install.sh                 # global (~/.claude)
./install.sh --project DIR   # agents, skill, kit and hook into DIR/.claude (skills stay global)
```

```powershell
# Windows (PowerShell; the gates run in Git Bash)
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Requires `jq` and `git` (and Git Bash on Windows) for the harness; Node ≥ 22.20, `npx`, and
the `claude` CLI for the skills. See `instructions.md` for details.

Design and plan: `docs/superpowers/specs/2026-11-07-orcs-harness-design.md`,
`docs/superpowers/plans/2026-11-07-orcs-harness.md`.
