---
name: orcs-pipeline
description: The Orcs Harness contract. The main session is the orchestrator; stage agents (analyst, architect, developer ×N, tester, task-observer) are subagents that hand off through owner-approved JSON contracts checked by deterministic gates and hooks. Covers roles and question rights, the run sequence, contract review, parallel developers and integration, the fast-path, budgets, and the per-project upskill loop. Load this FIRST in any Orcs session or agent.
---

# Orcs Harness

**Agents are intelligent; the harness is authoritative.** Rules that matter are enforced by
scripts and hooks, not by an agent's good intentions. Goal: the same request yields the
same delivered scope on a weak or a strong model — exactly what was asked, nothing assumed,
nothing extra. When a task is beyond the model, the harness stops and reports the gap.

## Kit layout
The installer places the kit at `~/.claude/orcs/` (or `<project>/.claude/orcs/`). At run
start, `init-run.sh` links it into the project as `.orcs/`, so every agent uses:
`.orcs/harness/*.sh` (gates), `.orcs/contracts/*.schema.json`, `.orcs/knowledge/*.md`.
Run state lives in the project at `executions/<task-id>/`.

## Roles and question rights

| Role | Runs as | May ask the owner? |
|---|---|---|
| Orchestrator | **main session** (you, when no agent is named) | Yes — the only one that can |
| Analyst | subagent | Yes, via `open_questions` relayed by the orchestrator |
| Architect | subagent | Yes, via `open_questions` (design options) relayed |
| Developer ×N | subagents, parallel, one per micro-task | **Never** — returns a `blocker` |
| Scope auditor | subagent (general-purpose + `.orcs/harness/scope-auditor/PROMPT.md`) | No |
| Tester | subagent, once, after integration | Only `flaws[]` for business-requirement defects |
| Task Observer | subagent, project end | Report + owner feedback block |

Subagents cannot prompt the user. Every subagent ends with an `ORCS-HANDBACK` block; the
orchestrator parses it mechanically.

## The orchestrator's run sequence (main session)

0. **Init**: in the project root run `bash ~/.claude/orcs/harness/init-run.sh ORCS-<n>`
   (creates `executions/ORCS-<n>/`, writes `executions/ACTIVE`, links `.orcs/`).
1. **Analyst** — dispatch with the owner's raw ask. On `needs_answers`: ask the owner every
   `open_questions` item (AskUserQuestion), re-dispatch with the previous contract + answers.
   Count each round: `.orcs/harness/budgets.sh executions/<id>/budgets.json analyst_iterations`.
   Budget breached with questions still open → stop and report; never proceed.
   `skill_proposals` → ask the owner; install approved skills **project-level only**.
2. **Contract review gate** — show the owner the contract (readable summary **and** raw
   JSON), highlighting `complexity`, scope, and `out_of_scope`. The owner approves or flags.
   Flag → re-dispatch the agent with the flag. Only on explicit approval:
   `.orcs/harness/approve.sh executions/<id> requirement executions/<id>/requirement.json owner`.
   **Every contract passes this gate: requirement, architecture (incl. each micro-task),
   test-report.** Never approve on the owner's behalf; silence is not approval.
3. **Architect** — dispatch (the hook blocks it until the requirement is approved). Same
   question loop, then review gate → `approve.sh … architecture …` (it refuses unless the
   requirement is approved, every approved BR-ID is covered with no invented ones, and
   `dag-ready.sh --strict` passes). Write the commands from `docs/03-architecture.md` into
   `executions/<id>/harness.conf`: `LINT_CMD`, `UNIT_TEST_CMD`, `INTEGRATION_TEST_CMD`
   (required; `none` to skip explicitly), `DEPENDENCY_FILES` (manifests, for the trip-wire).
   Approved files are sha256-locked: never edit one — re-review and re-approve instead.
4. **Path choice** — fast-path if the approved requirement is `complexity: low` and the
   architecture has exactly one micro-task; otherwise full path.
5. **Developers** — create the integration branch `git branch orcs/<id>/integration` (do
   **not** check it out anywhere; `integration.sh` refuses a checked-out integration branch).
   Loop:
   - `dag-ready.sh executions/<id>/architecture.approved.json executions/<id>/done.txt executions/<id>/inflight.txt`
     → ready ids (in-flight tasks count toward the cap of 3 and keep their files reserved).
   - For each ready id: `.orcs/harness/dev-worktree.sh <id> <DEV-n> orcs/<id>/integration`
     (prints WORKTREE, BRANCH, RUN, KIT and marks the task in flight); dispatch one developer
     per worktree **in a single message** (parallel), each given only its micro-task contract
     and those paths. Fast-path: one developer, one worktree.
   - Handback `blocked` → relay the blocker to the owner; fix the contract via an architect
     re-dispatch + re-approval. Never let a developer guess.
6. **Integration** (per built branch, **one at a time**):
   - Dispatch the scope auditor (general-purpose subagent, brief `.orcs/harness/scope-auditor/PROMPT.md`)
     on the branch diff at its current head; it writes `executions/<id>/<DEV-n>.audit.json`
     with that head's `commit`. Every new commit needs a new audit.
   - Run `.orcs/harness/integration.sh executions/<id> <DEV-n> orcs/<id>/<DEV-n> orcs/<id>/integration`.
     Order: approved-contract hashes → scope gate → scope audit → merge (temp worktree) →
     lint → unit tests → integration tests → trip-wire (complexity low) → move the
     integration branch. Evidence: `executions/<id>/<DEV-n>.integration.log`.
   - `REDISPATCH` → count `.orcs/harness/budgets.sh executions/<id>/budgets.json fix_cycles_<DEV-n>`
     (breach → stop and report), then re-dispatch that developer with the log.
   - `ESCALATE` (a `low` task that turned out bigger) → re-run the architect for a full
     decomposition, re-review, re-approve.
   - Repeat step 5 until every micro-task is merged and `integration.json` is `PASS`.
7. **Tester** — dispatch (the hook blocks it until integration PASS). Review gate on
   `test-report.json` → `approve.sh … test-report …`. `flaws[]` → relay to the owner.
8. **Task Observer** — dispatch; share `docs/07-observer-report.md` with the owner; the owner
   writes comments in `### User Feedback` and `APPROVED: …` in `### Owner Approval`.
   Re-dispatch the observer to apply only the approved changes; it stages them with
   `upskill-apply.sh`. The project is not done until this gate closes (or `APPROVED: none`).
9. **Clean up**: `git worktree remove` each `.orcs-wt/*`; delete `executions/ACTIVE`.

Log each event with `.orcs/harness/trace.sh <id> <field> <value> [stage]` (deterministic
fields only: stage_start/stage_end, iteration, rework_cycle, scope_violation, blocker,
test_pass/test_fail, escalation, audit_verdict).

## Gates (enforced — do not route around them)

| Gate | Script | Enforced by |
|---|---|---|
| Contract shape, BR-ID uniqueness, traceability | `validate-contract.sh` | agents + `approve.sh` + hook |
| Stage order (no stage without its approved inputs) | `hooks/block-stage-advance.sh` | Claude Code PreToolUse hook — hard block |
| File-level scope | `scope-gate.sh` | `integration.sh` |
| Behaviour-level scope (independent auditor) | `scope-audit.sh` | `integration.sh` |
| Disjoint parallel files, valid DAG | `dag-ready.sh` (`--strict` at approval) | `approve.sh` + orchestrator |
| Budgets | `budgets.sh` | orchestrator |
| Fast-path escalation | `complexity-tripwire.sh` | `integration.sh` (before the merge lands) |
| Approved contracts unchanged | sha256 in `approvals.log` | `approve.sh`, hook, `integration.sh` |
| Developer isolation + in-flight tracking | `dev-worktree.sh` | orchestrator, before dispatch |
| Upskill only with owner approval | `upskill-apply.sh` | observer |

A gate that fails stops the step. Report the gate's message to the owner verbatim. Never
edit an approved contract, a gate script, or a hook to make a step pass.

## Budgets (defaults; per-project overrides in `budgets.json`)
analyst_iterations 2 · architect_iterations 2 · fix_cycles per micro-task 3 ·
tester_cycles 2 · workflow_retries 3 · unapproved_dependencies 0 · concurrent developers 3.

## Fast-path
Drops orchestration only (no DAG fan-out, one developer). Never drops the scope gate, scope
auditor, tester, or budgets. The trip-wire escalates a mis-labelled `low` task.

## Skills each stage uses
`superpowers` (research before deciding) · `find-skills` (task skills, project-level, owner
approves) · `caveman` (all prose; never code or contracts) · `claude-mem` (human companion
docs `docs/01`, `03`, `06`; the JSON contract is the source of truth) · `impeccable` (all
frontend work) · `task-observer` (observation log + upskill loop).

## Hard rules
1. Never assume — unknowns become `open_questions` or a `blocker`.
2. Deliver only approved BR-IDs. Ideas for more scope are suggestions for the owner, not work.
3. Every contract is reviewed and approved by the owner before the next stage.
4. Fail loud: on a gate failure or a budget breach, stop, keep state, report.
5. Stack-agnostic: choose the stack per project by research, not habit.
