# Orcs — orchestrator reference (main session only)

Subagents never read this file. The main session reads it once, before step 0.

## Run sequence

0. **Init**: in the project root run `bash ~/.claude/orcs/harness/init-run.sh ORCS-<n>`
   (creates `executions/ORCS-<n>/`, writes `executions/ACTIVE`, links `.orcs/`) and state its
   `TARGET:` line to the owner — the score to beat and last run's weakest factor. The goal is
   a higher score than last time, reaching 100, **without** trading away correctness.
1. **Analyst** — dispatch with the owner's raw ask. On `needs_answers`: ask the owner every
   `open_questions` item in **one** AskUserQuestion batch, re-dispatch with the previous
   contract path + answers only (see "Re-dispatch with the delta").
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
   `dag-ready.sh --strict` passes — which also refuses over-decomposition, see Gates).
   Write the commands from `docs/03-architecture.md` into
   `executions/<id>/harness.conf`: `LINT_CMD`, `UNIT_TEST_CMD`, `INTEGRATION_TEST_CMD`
   (required; `none` to skip explicitly), `DEPENDENCY_FILES` (manifests, for the trip-wire).
   Approved files are sha256-locked: never edit one — re-review and re-approve instead.
4. **Path choice** — fast-path if the approved requirement is `complexity: low` and the
   architecture has exactly one micro-task; otherwise full path.
5. **Developers** — create the integration branch `git branch orcs/<id>/integration` (do
   **not** check it out anywhere; `integration.sh` refuses a checked-out integration branch).
   Loop:
   - **Token checkpoint** before every dispatch wave: `.orcs/harness/token-check.sh executions/<id>`.
     `WARN` → tell the owner in one line and continue. Exit 1 (`TOKEN BUDGET STOP`) → stop,
     ask the owner. Continue only if the owner raises `limits.token_stop_pct` in
     `budgets.json` (their decision, traced as an owner wait).
   - `dag-ready.sh --max "$(jq .limits.concurrent_developers executions/<id>/budgets.json)" executions/<id>/architecture.approved.json executions/<id>/done.txt executions/<id>/inflight.txt`
     → ready ids (default cap 10; in-flight tasks count toward the cap and keep their files reserved).
   - For each ready id: `.orcs/harness/dev-worktree.sh <id> <DEV-n> orcs/<id>/integration`
     (prints WORKTREE, BRANCH, RUN, KIT and marks the task in flight); dispatch one developer
     per worktree **in a single message** (parallel), each given only its micro-task contract
     and those paths. Fast-path: one developer, one worktree.
   - Handback `blocked` → relay the blocker to the owner; fix the contract via an architect
     re-dispatch + re-approval. Never let a developer guess.
6. **Integration** (per built branch, **one at a time**):
   - **Pre-check first** (no agent cost): `.orcs/harness/precheck.sh executions/<id> <DEV-n> orcs/<id>/<DEV-n> orcs/<id>/integration <WORKTREE>`
     — scope gate, lint, unit tests on the developer's own branch. `REDISPATCH` here → count
     the fix cycle and re-dispatch the developer; **do not dispatch the scope auditor** for a
     branch that fails pre-check.
   - Dispatch the scope auditor (general-purpose subagent, brief `.orcs/harness/scope-auditor/PROMPT.md`)
     on the branch diff at its current head; it writes `executions/<id>/<DEV-n>.audit.json`
     with that head's `commit`. Every new commit needs a new audit.
   - Run `.orcs/harness/integration.sh executions/<id> <DEV-n> orcs/<id>/<DEV-n> orcs/<id>/integration`.
     Order: approved-contract hashes → scope gate → scope audit → merge (temp worktree) →
     lint → unit tests → integration tests → trip-wire (complexity low) → move the
     integration branch. Evidence: `executions/<id>/<DEV-n>.integration.log`.
   - `REDISPATCH` → count `.orcs/harness/budgets.sh executions/<id>/budgets.json fix_cycles_<DEV-n>`
     (breach → stop and report), then re-dispatch that developer with
     `executions/<id>/<DEV-n>.failure.txt` (the failing step's excerpt) — never the whole log.
   - `ESCALATE` (a `low` task that turned out bigger) → re-run the architect for a full
     decomposition, re-review, re-approve.
   - Repeat step 5 until every micro-task is merged and `integration.json` is `PASS`.
7. **Testers** (sharded by BR-ID, adaptive):
   - `.orcs/harness/tester-shards.sh executions/<id> orcs/<id>/integration` → one line per
     shard `TEST-n <worktree> <BR-IDs> tc_start=<k> port_offset=<p>`. Shard count =
     `min(max_testers, approved BRs ÷ min_brs_per_tester)`, at least 1 (defaults 10 and 3).
   - Token checkpoint, then dispatch one tester per shard **in a single message**, each given
     only its shard line. Each writes `executions/<id>/test-report.TEST-n.json`.
   - `.orcs/harness/merge-test-reports.sh executions/<id>` → `test-report.json` (refuses a
     missing shard, a BR outside its shard, a duplicate TC id, or an uncovered BR).
   - Review gate on `test-report.json` → `approve.sh … test-report …`. `flaws[]` → relay to the owner.
   - Shard re-test: count `budgets.sh … tester_cycles_TEST-n`.
8. **Task Observer** — dispatch; share `docs/07-observer-report.md` with the owner; the owner
   writes comments in `### User Feedback` and `APPROVED: …` in `### Owner Approval`.
   The owner also writes `SATISFACTION: n/10`. Re-dispatch the observer to apply only the
   approved changes (staged with `upskill-apply.sh`) and record the final score with
   `.orcs/harness/score.sh executions/<id>` (exit 3 = pending: no valid owner rating under
   `### User Feedback` yet — nothing recorded). Report the score, the previous score, the
   best, and any WARNING lines to the owner. The project is not done until the upskill gate closes (or
   `APPROVED: none`) and the score is final.
9. **Clean up**: `git worktree remove` each `.orcs-wt/*`; delete `executions/ACTIVE`.

## Token discipline (orchestrator)

- **Re-dispatch with the delta.** A re-dispatched agent gets: its contract path, the flag /
  answers / `failure.txt` excerpt, and its previous handback. Never paste history, whole
  logs, or whole contracts into a prompt — give paths; the agent reads what it needs.
- **Read files, not dumps.** Read the handback block; open a contract or log only when a
  decision needs it, and then only the part it needs.
- **Batch owner questions.** One AskUserQuestion per round, every open question in it.
- **Compact at the two heavy points.** After architecture approval and after integration
  PASS, tell the owner in one line that it is a good moment to `/compact`.
- **Pre-check before audit.** A deterministic gate always runs before a paid agent.

## Tracing

Log each event with `.orcs/harness/trace.sh <id> <field> <value> [stage]` (deterministic
fields only: stage_start/stage_end, iteration, rework_cycle, scope_violation, blocker,
test_pass/test_fail, escalation, audit_verdict, owner_wait_start/owner_wait_end).
**Owner-wait tracing is mandatory**: `owner_wait_start` right before every question relay,
contract review, blocker, flaw, or token stop you put to the owner, `owner_wait_end` when the
answer arrives. The score's speed factor excludes only traced waits; untraced waits count as
harness time.

## Gates (enforced — do not route around them)

| Gate | Script | Enforced by |
|---|---|---|
| Contract shape, BR-ID uniqueness, traceability | `validate-contract.sh` | agents + `approve.sh` + hook |
| Stage order (no stage without its approved inputs) | `hooks/block-stage-advance.sh` | Claude Code PreToolUse hook — hard block |
| File-level scope | `scope-gate.sh` | `precheck.sh` + `integration.sh` |
| Behaviour-level scope (independent auditor) | `scope-audit.sh` | `integration.sh` |
| Disjoint parallel files, valid DAG, no over-decomposition | `dag-ready.sh` (`--strict` at approval) | `approve.sh` + orchestrator |
| Budgets | `budgets.sh` | orchestrator |
| Token budget (warn 80 %, stop 150 % of reference) | `token-check.sh` | orchestrator, before each dispatch wave |
| Cheap checks before a paid auditor | `precheck.sh` | orchestrator, before the auditor |
| Tester shards: disjoint, complete, unique TC ids | `tester-shards.sh`, `merge-test-reports.sh` | orchestrator |
| Fast-path escalation | `complexity-tripwire.sh` | `integration.sh` (before the merge lands) |
| Approved contracts unchanged | sha256 in `approvals.log` | `approve.sh`, hook, `integration.sh` |
| Developer isolation + in-flight tracking | `dev-worktree.sh` | orchestrator, before dispatch |
| Upskill only with owner approval | `upskill-apply.sh` | observer |
| Reward score (deterministic, recorded) | `score.sh`, `tokens.sh`, `knowledge/scoring.conf` | observer, at project end |

A gate that fails stops the step. Report the gate's message to the owner verbatim. Never
edit an approved contract, a gate script, or a hook to make a step pass.

## Budgets (defaults; per-project overrides in `budgets.json`)

analyst_iterations 2 · architect_iterations 2 · fix_cycles per micro-task 3 ·
tester_cycles per shard 2 · workflow_retries 3 · unapproved_dependencies 0 ·
concurrent_developers 10 · max_testers 10 · min_brs_per_tester 3 ·
max_tasks_per_br 2 · token_warn_pct 80 · token_stop_pct 150.

Parallelism is capped by the DAG, not by the cap: developers exist one per micro-task, so a
higher cap only lets independent tasks run together. Integration stays serial.

## Fast-path

Drops orchestration only (no DAG fan-out, one developer). Never drops the scope gate, scope
auditor, tester, or budgets. The trip-wire escalates a mis-labelled `low` task.
