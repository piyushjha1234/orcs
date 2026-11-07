# Orcs Harness — Design Specification

**Date:** 2026-11-07
**Status:** Draft for approval
**Supersedes:** the "Orcs pipeline" model (linear analyst→architect→developer→tester)

---

## 1. Intent & Why

Orcs today is a **linear pipeline** of five markdown subagents (analyst, architect,
developer, tester, task-observer). Each stage runs in a fresh Claude Code session,
receives only the prior stage's handover doc, and is governed by politely-worded
rules in its prompt.

The problem the owner wants solved: **model-dependence**. When a larger / stronger
model is used, it over-assumes, invents scope, and builds things that were never
asked for ("I should also test xyz", extra abstractions, speculative features).
Weaker models under-deliver. The output quality swings with the model.

**Goal of the redesign:** evolve Orcs from a *pipeline* (agents that decide for
themselves) into a *harness* (a controlled system where the scaffold is
authoritative and the agents are interchangeable components).

> **North-star principle (from harness engineering):**
> *Agents are intelligent; the harness is authoritative.*
> Rules the model could talk itself out of become rails enforced in deterministic
> code. The result must be **model-invariant**: the same request yields the same
> delivered scope whether the chosen model is weak or strong — *exactly what was
> asked, nothing assumed, nothing extra.*

This research direction is the owner's, captured in a ChatGPT consultation
("Optimise ORCS With Harness Engineering"). This document adapts that research to
the reality that Orcs is **Claude Code-native** (markdown subagents + skills),
not a from-scratch Python framework.

---

## 2. Goals / Non-Goals / Anti-Goals

### Goals
- **Model-invariant scope.** Any model delivers exactly the approved requirements —
  no missing acceptance criteria, no unrequested additions.
- **Machine-checked handoffs.** Stages exchange structured **contracts** (JSON)
  validated by deterministic code, not by an LLM re-reading prose.
- **Role-scoped questioning.** Analyst and architect may ask the user; developer
  never asks (blind-builds its assignment); tester asks only on a business-
  requirement flaw.
- **Parallel development.** The orchestrator decomposes the architecture into
  micro-tasks and runs multiple developer subagents in parallel, then integrates
  into one product, verified by **one independent tester**.
- **Independent testing.** The tester designs test cases/scenarios from the
  requirements + architecture (not from the developer's code) using fixed
  best-practice testing guidelines, with full requirement traceability.
- **Per-project upskilling.** After every project the task-observer produces an
  evidence-based report; the user adds feedback in markdown comments; approved
  changes are committed to the Orcs repo = versioned learning.
- **Fail loud, never hallucinate.** When a task exceeds the chosen model's
  capability, the harness stops and reports the gap rather than guessing or looping.

### Non-Goals (now; may come later, tagged Optional)
- Model routing by complexity tier (cost optimisation). The owner's target is
  *same result on any model*, not *cheapest model per task*. **Off by default.**
- A benchmark/eval harness that auto-promotes agent changes (Tier 3 learning).
- A headless external driver script (C2). Deferred until CI/headless runs are needed.
- Rebuilding orchestration as a standalone Python framework driving raw LLM APIs.

### Anti-Goals (failure even if it "works")
- Reproducing the owner's exact pain inside the harness itself — i.e. **building
  more than the stated problem needs.** The full 4-phase platform from the research
  is itself over-engineering relative to the need; shipping all of it would violate
  the anti-over-engineering principle the harness is meant to enforce.
- Enforcement that lives only in prompt text a strong model can rationalise past.
- A learning loop that reads transcripts and "suggests better reasoning" instead of
  measuring evidence.

---

## 3. Constraints (Claude Code reality)

1. **Subagents cannot prompt the user.** A Claude Code subagent has no channel to
   ask the user a question mid-run (recorded observation: Orcs agents list
   `AskUserQuestion` but cannot use it as subagents). Therefore **all user
   questioning must be relayed by the main session**, which is the only context
   that can reach the user.
2. **Parallelism is native.** The main Claude Code session can dispatch multiple
   subagents concurrently; git worktrees give each an isolated working tree. No
   external framework is required for parallel developers.
3. **Per-agent model selection exists.** Agent markdown frontmatter can pin a
   `model:`; dynamic routing would require a controller but is out of scope now.
4. **Deterministic verification must be real.** Mock-only verification has masked
   real bugs before (recorded observation). Integration and acceptance checks run
   against the **runnable integrated artifact**, not mocks.

---

## 4. Approaches Considered

### Substrate (how the harness is built)
- **A — External code harness.** Build the Python orchestrator the research
  describes (`orchestrator.py`, `model_router.py`, JSON-schema validators, state
  machine) driving models via API. *Rejected:* multi-week framework build, discards
  Claude Code's native subagent/tool/permission machinery, must be maintained,
  needs per-tier API keys. Over-built for the stated need.
- **B — Claude Code-native hardening.** Keep markdown subagents; add contracts,
  principles, and gates enforced by hooks + deterministic scripts. *Good, but*
  cannot do real parallel developers on its own.
- **C — Hybrid (CHOSEN).** B plus a thin orchestration layer for parallel
  developers (git worktrees) and integration. Matches the owner's time budget and
  anti-over-engineering goal; keeps everything Claude Code provides.

### Orchestrator location (who drives C)
- **C1 — the main interactive Claude Code session (CHOSEN).** It reads the
  architect's micro-task DAG, spawns parallel developer subagents, runs the
  integration gate via Bash, and — critically — is the only context that can relay
  analyst/architect questions to the user. No framework to maintain; human stays
  reachable.
- **C2 — a headless driver script.** Repeatable/CI-friendly, true out-of-process
  budgets, but more to build and **cannot ask the user anything**. Deferred as a
  later option for CI runs only.

**Decision: substrate C, orchestrator C1.**

---

## 5. Architecture

```
                         ┌─────────────────────────────────────────┐
                         │  ORCS HARNESS  (main Claude Code session) │
                         │  state · context isolation · gates ·      │
                         │  budgets · user-question relay ·          │
                         │  parallel dispatch · integration          │
                         └─────────────────────────────────────────┘
                                          │
   Analyst ──► Architect ──► Micro-task DAG ──► Parallel Dev Pool ──► Integration ──► Tester ──► Observer
  (may ask)   (may ask)     (decomposer +      (Dev1 Dev2 Dev3,       Manager        (independent, (report +
                            DAG scheduler)      blind-build, in        (deterministic) conditional   user feedback
                                                isolated worktrees)                    question)     → upskill)
                                          │
                         ┌─────────────────────────────────────────┐
                         │  Shared engineering knowledge (in repo)   │
                         │  ENGINEERING_PRINCIPLES.md ·              │
                         │  TESTING_GUIDELINES.md · contract schemas │
                         │  · execution traces · lessons learned      │
                         └─────────────────────────────────────────┘
```

### 5.1 Roles & question permissions

| Role | May ask the user? | Rule |
|---|---|---|
| **Analyst** | Yes (via relay) | relevant clarifying questions until `open_questions` empty |
| **Architect** | Yes (via relay) | relevant design questions; presents options for the user to choose |
| **Developer** | **No** | blindly builds its assigned micro-task; if blocked, returns a `blocker`, never a question |
| **Tester** | Conditional | raises a `flaw` only when a business requirement is contradictory, unmeetable, or failed |
| **Observer** | At project end | shares report; user responds in markdown comments |

**Question relay (resolves the subagent constraint):** analyst/architect subagents
emit `open_questions[]` inside their contract. The main session surfaces them to the
user (real prompt), feeds answers back, and re-dispatches. A stage gate opens only
when `open_questions` is empty.

### 5.2 Contracts (the core change)

Every stage emits a structured, machine-readable contract. The harness validates it
deterministically (JSON Schema) before the next stage starts. Human-readable
handover docs (`docs/0X-*.md`) remain, but **the contract is the source of truth**.

Contract set (schemas live in `contracts/`):
- **requirement.schema.json** — `task_id`, `objective`, `requirements[]` (each with
  unique **BR-ID**, description, priority, acceptance_criteria[]), `assumptions[]`,
  `open_questions[]`, `out_of_scope[]`, `complexity`.
- **architecture.schema.json** — `approach`, `components[]`,
  `requirement_mapping{BR-ID → components}`, `new_dependencies[]` (each justified),
  `alternatives_considered[]`, `implementation_steps[]`, `open_questions[]`.
- **microtask.schema.json** — `task_id`, `parent_task`, `requirements[]` (BR-IDs),
  `dependencies[]`, `allowed_files[]`, `expected_outputs[]`, `acceptance_criteria[]`,
  `constraints[]`, `budget`, `status`.
- **implementation.schema.json** — `files_changed[]`, `requirements_implemented[]`,
  `dependencies_added[]`, `known_limitations[]`, `blocker` (nullable).
- **test-report.schema.json** — `results[]` (per BR-ID: status, evidence),
  `scenarios[]`, `traceability{BR-ID → test_case_ids}`, `flaws[]`, `overall_status`.
- **execution-trace.schema.json** — per run: tokens, iterations, rework cycles,
  scope violations, blockers, model escalations, timings.

**Rules baked into validation:**
- Every requirement has a unique BR-ID; the analyst cannot add requirements the user
  did not approve; missing info goes to `open_questions`, never invented.
- The architect must justify every `new_dependency` and map every BR-ID to a
  component (unmapped BR-ID = validation failure).
- A developer touching a file outside its `allowed_files` = rejected at integration.

### 5.3 Model-invariance enforcement (the mechanism)

Three deterministic gates make the delivered scope independent of the model:

1. **Scope gate (anti-extra / anti-missing).** Every changed file and behavior must
   map to an approved BR-ID (frozen in `requirements.approved.json`, §5.8). A strong
   model that adds unrequested scope → the extra is **rejected**. A weak model that
   omits a criterion → **rejected with the exact gap**. Both converge on "exactly what
   was asked." Enforced at **two levels**:
   - **File-level (deterministic, Bash):** changed files ↔ `allowed_files` / approved
     outputs. Mechanical, no LLM.
   - **Behavior-level (independent scope-auditor):** a focused review pass maps every
     changed function/branch in the diff to a BR-ID; anything unmapped is flagged and
     **rejected**. This catches extra behavior *inside* an allowed file — the owner's
     core pain (strong model adds unrequested logic). The auditor is an independent
     reviewer (not the developer, so no rubber-stamp); its yes/no verdict per change is
     recorded deterministically in the trace. This is the one LLM step inside
     enforcement; it is a narrow mapping judgement, not a build, so its variance is low
     and its verdict is logged, not trusted blindly.
2. **Acceptance gate (anti-invented-testing).** The tester validates **only** the
   acceptance_criteria in the requirement contract, via the traceability matrix. No
   criterion untethered from a BR-ID is tested; no BR-ID is left untested.
3. **Fail-loud rule.** If tests fail or a budget is exceeded, the harness **stops and
   reports the gap** — it never hallucinates a solution or loops indefinitely.

**Honest limit:** these gates guarantee *scope*, not *capability*. The harness cannot
make a weak model solve a task beyond its reasoning ability — but it detects that
(failed acceptance / exhausted budget) and fails loudly, which is itself a
model-invariant, correct outcome.

**Anti-over-engineering policy** — `knowledge/ENGINEERING_PRINCIPLES.md`, injected
into every agent's context *and* enforced where mechanical: solve only the stated
problem; prefer existing components; evidence over assumption (tag claims
verified / inferred / unknown; never let inferred become fact); map every change to
a BR-ID; reuse existing architecture; stop when acceptance passes; no unrelated
refactoring.

### 5.4 Parallel developers → integration → one tester

1. **Decompose.** The architect (or a deterministic decomposer module) turns the
   design into a **micro-task DAG** — nodes are micro-task contracts with
   `dependencies` and `allowed_files`.
2. **Schedule.** The orchestrator computes ready tasks (dependencies satisfied) and
   dispatches up to **3 developer subagents** (initial concurrency cap) in parallel,
   each in its **own git worktree + branch**, given **only its micro-task contract**
   as context.
3. **Isolate.** `allowed_files` ownership + separate worktrees prevent collisions. A
   developer blocked by ambiguity returns a `blocker`; the orchestrator surfaces it
   to the user. Developers never guess and never ask directly.
4. **Integration Manager (deterministic control, not an LLM editor).** Per branch:
   verify only `allowed_files` / declared outputs were touched → **scope-auditor pass**
   (behavior-level BR-ID mapping, §5.3) → lint/syntax → run that task's unit tests →
   merge **sequentially** → run integration tests against the **real integrated
   artifact**. Reject on scope violation, unmapped behavior, or test failure → bounded
   fix cycle = re-dispatched developer subagent (§5.8), never a code edit by the
   Integration Manager itself.
5. **One independent tester.** Runs last, end-to-end, on the integrated product.

### 5.5 Independent tester

- **Inputs:** requirement contract + architecture contract + business requirements +
  the runnable integrated system. **Not** the developer's implementation reasoning —
  this prevents the tester inheriting the developer's assumptions (no rubber-stamp).
- **Guidelines:** fixed `knowledge/TESTING_GUIDELINES.md` always injected
  (equivalence partitioning, boundary-value analysis, positive / negative / edge,
  traceability). Fixed, not per-run discovered, so **test rigor is model-invariant**.
- **Design vs scope:** the tester *creates* thorough test cases and scenarios that
  **exercise the stated requirements** (rigor within scope) but invents no scenario
  untethered from a BR-ID (no scope creep).
- **Traceability matrix:** every BR-ID → ≥1 test case; every test case → a BR-ID. A
  test with no BR-ID is dropped; a BR-ID with no test blocks as a coverage gap.
- **Questioning:** raises a `flaw` only on a business-requirement defect.

### 5.6 Budgets

Enforced by the orchestrator; on breach: **stop, preserve state, report why** — never
retry indefinitely. Initial limits (tunable per project):

| Parameter | Initial limit |
|---|---|
| Analyst iterations | 2 |
| Architect iterations | 2 |
| Developer fix cycles (per micro-task) | 3 |
| Tester verification cycles | 2 |
| Total workflow retries | 3 |
| Unapproved new dependencies | 0 |
| Concurrent developers | 3 |

### 5.7 Three layers (separation of concerns)

- **Intelligence (LLM subagents):** analyst, architect, developer, tester, observer.
- **Deterministic engineering (code/Bash):** JSON-schema validation, file-scope
  checks, lint/syntax, test execution, requirement-coverage mapping, git worktree &
  merge operations. *No LLM is used to validate JSON, decide if a test passed, or
  detect a file change.*
- **Control (main session / harness):** state, context isolation, gates, budgets,
  user-question relay, parallel dispatch, trace collection.

### 5.8 Builder-check resolutions (2026-11-07) — settled calls

A fresh builder review surfaced gaps. These are resolved as follows (owner may
override); the three decisions that materially change build size/guarantee are in
§10 for the owner.

- **Approval baseline (gap 1).** The analyst gate sign-off *freezes* the requirement
  contract into a committed approval artifact: `executions/<task-id>/requirements.approved.json`
  plus an explicit approval marker (approver + date, recorded by the main session when
  the user signs off). The scope gate compares against this frozen set — it is the
  deterministic ground truth. `open_questions`-empty opens the gate; the frozen
  artifact records *what* was approved.
- **allowed_files for greenfield + parallelism (gap 3).** (a) A micro-task declares
  `expected_outputs[]` for files it will *create*; creating a declared output is
  allowed. A task that discovers it needs an undeclared file must return a `blocker`
  (developers never silently create unplanned files, never ask) — the orchestrator
  surfaces it to the user. (b) The decomposer **must** produce disjoint `allowed_files`
  across tasks scheduled in the same DAG stage; tasks whose file sets would overlap are
  placed in different stages (serialized), never run concurrently.
- **Integration fix actor (gap 4).** The Integration Manager is deterministic for
  *detection* only (scope check, lint, tests). It never edits code. A scope violation
  or failed test triggers a **re-dispatched developer subagent** on the same
  micro-task, given its contract + the failure evidence, burning one of that task's 3
  fix cycles. Budget exhausted → fail loud, preserve state, report to user.
- **Question-relay rounds (gap 6).** Each analyst/architect relay round counts as one
  of that stage's 2 iterations. The re-dispatched subagent receives its prior contract
  + the new Q&A answers (carried, not fresh-blank — preserves work, stays token-lean).
  Questions still unresolved at iteration-budget exhaustion → **fail loud** (stop,
  report unresolved questions); never proceed with open questions.
- **Gate binding = Hybrid (owner-decided).** Claude Code **hooks hard-block** the
  critical gates — scope gate, contract validation, and the integration merge — so the
  orchestrator session physically cannot advance a stage until the gate script exits 0.
  Softer flow steps stay skill-instructed. This closes the "LLM orchestrator talks
  itself past a rule" hole where it matters, without a hook on every transition.
- **Anti-extra = independent scope-auditor (owner-decided).** See §5.3 behavior-level.
  The headline "strong model adds scope → rejected" is backed by this pass, not by
  file ownership alone.
- **Execution trace = deterministic fields only, now (owner-decided).** Tier-1 trace
  captures wall-clock timings, iteration counts, rework cycles, scope violations,
  blocker counts, test pass/fail — all code-measurable. Token/cost capture is
  **deferred** to Phase 4 (needs a CLI/log parse path); those fields stay null until
  then. No self-reported token numbers (an LLM cannot measure its own usage reliably).
- **Decomposer invariance (builder minor note).** Decomposition is a reasoning step
  (done by the architect), so the *partitioning* of work across developers may vary by
  model. That is acceptable because every micro-task is deterministically validated to
  map to approved BR-IDs with acceptance criteria copied from the requirement contract
  — so the *delivered scope* stays model-invariant even if the split differs. Variation
  in how work is divided does not change what is delivered.

### 5.9 Human contract-review gate (owner-decided)

Every stage's contract (requirement, architecture, each micro-task, test-report) is
surfaced to the owner **before the next agent is dispatched**. The owner approves or
flags anything — wrong `complexity`, wrong scope, bad `allowed_files`, missing BR-ID.
A flag loops the correction back to the emitting agent, which re-emits; the owner
re-reviews. Only owner approval advances the stage. This is the deliberate control
point and the **complexity safeguard**: the owner sees `complexity` on both the
requirement contract and the micro-task contracts and can override before the
fast-path runs. Cost: a human stop at each contract (accepted trade for control).
Later option: let low-risk contracts auto-pass; starts as review-all.

### 5.10 Trivial-task fast-path (owner-decided)

`complexity: low` routes to a lighter lane that drops **orchestration overhead only**,
never scope enforcement:

| Step | Full path | Fast-path (low) |
|---|---|---|
| Micro-task DAG decomposition | yes | skipped (single unit) |
| Parallel devs + git worktrees | yes | skipped (single dev, main tree) |
| N-branch integration merge | yes | skipped |
| Scope gate + scope-auditor | yes | **kept** |
| Acceptance gate + tester | yes | **kept** |
| Fail-loud + budgets | yes | **kept** |

**Rule: drop parallelization, never drop scope enforcement.** Guardrail against a
mis-labelled `low`: a deterministic **trip-wire** — if a `low` task touches more than a
set file count, adds a dependency, or exceeds budget, it **auto-escalates to the full
path**. The classifier cannot cheat; the trip-wire catches it in code. (And the owner
sees `complexity` at the review gate, §5.9.)

### 5.11 Stage transitions — how a task moves between agents

There is no queue daemon. **The main session (orchestrator, C1) is the mover; the
handoff artifact is a committed contract file; the transport is subagent dispatch +
the shared filesystem** (`executions/<task-id>/`). Per task:

1. **Analyst** subagent → writes `requirements.json` + handover doc → returns handback
   (incl. `open_questions`).
2. Orchestrator relays `open_questions` to the owner; loops until empty.
3. **Hook gate (hard-block):** `validate-contract.sh` checks the JSON vs schema;
   exit ≠ 0 → cannot advance.
4. **Contract-review gate (§5.9):** owner approves/flags → freeze
   `requirements.approved.json`.
5. Orchestrator dispatches **Architect** (fresh session) given **only** the approved
   requirement contract path → writes `architecture.json` + micro-task DAG.
6. Validate → owner review → approve. (`low` + trip-wire clear → fast-path §5.10.)
7. Orchestrator reads the DAG, computes ready tasks, spawns **N developer subagents in
   parallel**, each given **only its own micro-task contract** + its worktree → each
   writes `implementation.json`.
8. **Integration Manager** (deterministic): scope → scope-auditor → lint → tests →
   merge → integration tests. Reject → re-dispatch that developer (§5.8).
9. Orchestrator dispatches **Tester** given requirement + architecture contracts + the
   integrated artifact (not the developer's reasoning) → writes `test-report.json`.
10. Validate → owner review → **Observer** report + owner markdown feedback → approved
    upskill commit (§6).

**Invariants:** each agent is a fresh subagent handed only its required contract
paths (token-lean isolation); the committed contract file is the sole handoff (chain
is traceable + resumable); hooks enforce that critical gates cannot be skipped by the
LLM orchestrator; the orchestrator never edits code or contracts — it only dispatches,
validates, relays, and surfaces to the owner.

---

## 6. Feedback & Upskilling Loop (per-project, mandatory end gate)

The project is **not "done"** until this completes.

1. **Observer writes `docs/07-observer-report.md`** — evidence-based, from the
   execution traces + contracts, not transcripts: per-agent metrics (requirement
   coverage, scope violations, rework cycles, blocker/hallucination incidents, model
   escalations) and **root-cause attribution** (blame the under-specified upstream
   contract, not "upgrade the downstream model").
2. **User adds feedback in a `## User Feedback` markdown block** inside that report.
   (Markdown chosen over Claude Docs so the whole feedback + change history stays in
   git: traceable, reversible, repeatable, headless-safe.)
3. **Merge → proposed change set** against Orcs's own assets: agent instruction
   files, `ENGINEERING_PRINCIPLES.md`, `TESTING_GUIDELINES.md`, contract schemas, the
   `orcs-pipeline` skill.
4. **User approves** (explicit gate; nothing changes unapproved).
5. **Commit to git** with a changelog entry = **versioned upskilling**. The next
   project's agents inherit the improved instructions.
6. *(Optional, Tier 3)* benchmark re-run before promoting a change; promote only on
   no-regression.

This specialises the existing `task-observer` skill (already logs cross-session
observations) by adding the per-project end gate that converts the log + user
comments into an approved, committed change set.

---

## 7. Repo Layout (what changes in the Orcs repo)

```
orcs/
├── agents/                      # existing subagents, rewritten for the harness
│   ├── analyst.md               #  + emits requirement contract, relays questions
│   ├── architect.md             #  + emits architecture contract + micro-task DAG
│   ├── developer.md             #  + blind-build, micro-task contract, no questions
│   ├── tester.md                #  + independent, guidelines, traceability
│   └── task-observer.md         #  + evidence-based report + feedback gate
├── harness/                     # NEW — deterministic engineering + control (Bash/scripts)
│   ├── validate-contract.sh     #  JSON-schema validation
│   ├── scope-gate.sh            #  file-level changed files ↔ BR-ID / allowed_files
│   ├── scope-auditor/           #  behavior-level BR-ID mapping (independent review pass)
│   ├── integration.sh           #  worktree verify · scope-audit · lint · test · merge
│   ├── budgets.sh               #  counters + stop-and-report
│   └── hooks/                    #  Claude Code hooks that hard-block critical gates
│       └── block-stage-advance.sh  #  exit!=0 until scope/contract/integration gate passes
├── contracts/                   # NEW — JSON schemas (source of truth)
│   ├── requirement.schema.json
│   ├── architecture.schema.json
│   ├── microtask.schema.json
│   ├── implementation.schema.json
│   ├── test-report.schema.json
│   └── execution-trace.schema.json
├── knowledge/                   # NEW — injected guidance
│   ├── ENGINEERING_PRINCIPLES.md
│   └── TESTING_GUIDELINES.md
├── skills/orcs-pipeline/        # rewritten as the harness contract ("orcs-harness")
├── docs/                        # per-project deliverables + this spec
├── install.sh / install.ps1     # updated to lay down harness/ contracts/ knowledge/
├── readme.md / instructions.md  # updated: "harness", not "pipeline"
└── executions/<task-id>/        # NEW — per-run contracts + traces (git-tracked)
```

---

## 8. Observability / Learning Tiers

- **Tier 1 — Required (uses what exists).** Each stage writes its contract +
  `execution-trace.json` (deterministic fields only: timings, iteration counts, rework
  cycles, scope violations, blocker counts, test pass/fail — no token self-report);
  task-observer reads traces (not vibes) → proposes instruction/principle edits → user
  approves → committed to git.
- **Tier 2 — Optional.** A deterministic metrics script computes coverage /
  scope-violation / first-pass-build rates from traces so proposals are numbers.
- **Tier 3 — Optional, heavy.** A 20–30 task benchmark library; re-run old-vs-new
  before promoting any agent change; promote only on measured improvement + no
  regression. This is a project of its own; deferred.

---

## 9. Left to the Builder (decisions a sensible builder may settle)

- Exact JSON-schema field types/enums and the schema-validation tool (e.g. `ajv`,
  `python -m jsonschema`, or a vendored validator) — pick what the repo's runtime
  already has; no new heavy dependency.
- The precise shape of the micro-task DAG representation (inline in the architecture
  contract vs a separate `dag.json`).
- Worktree naming/cleanup conventions and the merge order within a DAG stage.
- How the orchestrator is expressed in C1: a rewritten `orcs-pipeline`/`orcs-harness`
  skill that the main session follows, plus the `harness/` Bash helpers it calls. The
  *binding* is decided (§5.8): hooks hard-block scope/contract/integration gates; the
  skill drives the soft flow. Builder picks hook event wiring and script internals.
- Whether the decomposer is a deterministic module or a short architect sub-step.

## 10. Owner Decisions (resolved 2026-11-07)

- **Gate binding:** Hybrid — hooks hard-block scope gate, contract validation, and
  integration merge; soft flow skill-instructed.
- **Anti-extra scope:** independent scope-auditor pass (behavior-level BR-ID mapping),
  not file ownership alone.
- **Execution trace:** deterministic fields only now; token/cost deferred to Phase 4.
- **Still Optional/off:** model routing, learning Tiers 2–3, headless driver (C2) —
  revisit after the first project runs on the new harness. Nothing here blocks Phase 1.

---

## 11. Phased Roadmap

1. **Phase 1 — Control.** Contracts + schemas, `ENGINEERING_PRINCIPLES.md`,
   `TESTING_GUIDELINES.md`, scope gate + scope-auditor, contract validation, hook
   hard-blocks, human contract-review gate (§5.9), rewritten agent files, the C1
   orchestrator skill. (Delivers model-invariant scope + role permissions + owner
   review of every contract.)
2. **Phase 2 — Parallelism.** Micro-task DAG, worktree dispatch, integration manager,
   budgets. (Delivers multiple developers → one tester.)
3. **Phase 3 — Learning Tier 1.** Execution traces + per-project observer report +
   markdown feedback gate + git-versioned upskilling.
4. **Phase 4 — Optional.** Metrics (Tier 2), benchmark eval (Tier 3), model routing,
   headless driver (C2).

## 12. Success Criteria

- The same requirement, run on a weak and a strong model, yields the **same delivered
  scope** (same BR-IDs implemented, no unrequested files/behaviour) — verified by the
  scope gate rejecting divergence in both directions.
- Developer subagents run in parallel in isolated worktrees and integrate into one
  product with zero out-of-scope file edits reaching `main`.
- The tester's coverage = 100% BR-ID traceability, with no scenario lacking a BR-ID.
- Every project ends with an observer report + user feedback + an approved, committed
  change set (or an explicit "no changes" record).
```
