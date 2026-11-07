# Orcs Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Orcs from a prompt-governed pipeline into a harness where deterministic gates (not agent goodwill) enforce model-invariant scope, parallel developers, independent testing, and a per-project upskill loop.

**Architecture:** Claude Code-native. Agents stay markdown subagents (intelligence layer). A new `harness/` of jq-based Bash scripts + Claude Code hooks is the deterministic control layer; stages hand off via committed JSON contracts in `executions/<task-id>/`. The main session (C1) orchestrates: dispatch, validate, relay questions, surface every contract to the owner.

**Tech Stack:** Bash + jq (validation/gates; jq 1.7.1 present, no node/python-jsonschema on box), git worktrees (parallel devs), JSON Schema (contract docs), Markdown (agents, skill, knowledge). Plain-bash test scripts (no bats).

**Spec:** `docs/superpowers/specs/2026-11-07-orcs-harness-design.md`

## Global Constraints

- Zero new runtime dependency beyond `jq` + `git` + `bash`. No node/python required by harness scripts (node stays required only by the 6-skill installer).
- `validate-contract.sh` enforces, via jq, the fields/enums the gates depend on; JSON Schema files are authoritative docs + optional ajv/jsonschema use when present.
- Every deterministic script: exit `0` = pass, non-zero = fail, with a one-line reason on stderr. Gates never edit code or contracts.
- Scope enforcement is never skipped, including the fast-path. Only orchestration (DAG/parallel/merge) is skipped for `complexity: low`.
- The skill keeps its installed name `orcs-harness` (agents reference it by that name); its content becomes the harness contract.
- Caveman applies to chat + handover prose only — never to code, schemas, scripts, or these deliverable files.
- All prose deliverables (agents, knowledge, readme) use conventional professional English.

## Review Focus

- **Mis-labelled `complexity: low`** that touches many files or adds a dependency → `complexity-tripwire.sh` must auto-escalate to the full path (Task 10).
- **A developer branch editing a file outside `allowed_files`** → `scope-gate.sh` must reject before merge (Task 4).
- **Two parallel micro-tasks with overlapping `allowed_files`** → `dag-ready.sh` must refuse to schedule them in the same stage (Task 11).
- **A contract with a duplicate or missing BR-ID** → `validate-contract.sh` must fail (Task 2).
- **An integration test failing after a clean per-branch merge** → `integration.sh` must reject the integrated result and signal re-dispatch, not pass (Task 12).

---

## File Structure

```
orcs/
├── contracts/
│   ├── requirement.schema.json  architecture.schema.json  microtask.schema.json
│   ├── implementation.schema.json  test-report.schema.json  execution-trace.schema.json
│   └── fixtures/<name>/{valid.json, invalid-*.json}
├── knowledge/ENGINEERING_PRINCIPLES.md  TESTING_GUIDELINES.md
├── harness/
│   ├── lib/common.sh            shared bash helpers (die, jq_get, require)
│   ├── validate-contract.sh     jq field/enum/BR-ID checks vs a named contract kind
│   ├── scope-gate.sh            changed files ↔ allowed_files/outputs ↔ approved BR-IDs
│   ├── scope-audit.sh           wraps/records the behavior-level auditor verdict
│   ├── scope-auditor/PROMPT.md  the independent auditor's review brief (LLM pass)
│   ├── budgets.sh               per-stage counters; stop-and-report on breach
│   ├── complexity-tripwire.sh   fast-path escalation check
│   ├── dag-ready.sh             ready-task set + disjoint allowed_files assertion
│   ├── integration.sh           worktree verify→scope→audit→lint→test→merge→itest
│   ├── trace.sh                 append deterministic execution-trace fields
│   ├── hooks/block-stage-advance.sh   hook: run the stage's gate, block on non-zero
│   └── tests/                   run.sh + per-script *_test.sh (plain bash)
├── agents/{analyst,architect,developer,tester,task-observer}.md   (rewritten)
├── skills/orcs-harness/skill.md   (rewritten = harness contract)
├── executions/README.md  .gitkeep                  per-run contract+trace layout
├── install.sh  install.ps1                          (lay down new dirs)
└── readme.md  instructions.md                       (harness, not pipeline)
```

---

## Phase 1 — Control

### Task 1: Contract schemas + fixtures

**Files:**
- Create: `contracts/{requirement,architecture,microtask,implementation,test-report,execution-trace}.schema.json`
- Create: `contracts/fixtures/<kind>/valid.json` and ≥1 `invalid-*.json` per kind

**Interfaces:**
- Produces: the field names/enums every later task relies on. Key fields per spec §5.2: requirement(`task_id`,`requirements[].id|priority|acceptance_criteria`,`assumptions`,`open_questions`,`out_of_scope`,`complexity`), microtask(`task_id`,`parent_task`,`requirements`,`dependencies`,`allowed_files`,`expected_outputs`,`acceptance_criteria`,`constraints`,`budget`,`status`), etc.

- [ ] **Step 1:** Author the 6 JSON Schema files (draft-07, `required` + `enum` for `priority`∈{must,should,could}, `complexity`∈{low,medium,high}, `status`).
- [ ] **Step 2:** Create fixtures: one `valid.json` per kind and invalid variants hitting Review-Focus (duplicate BR-ID, missing `allowed_files`, bad enum).
- [ ] **Step 3: Verify** each `valid.json` parses: `for f in contracts/fixtures/*/valid.json; do jq -e . "$f" >/dev/null || echo "BAD $f"; done` → no output.
- [ ] **Step 4: Commit** `feat(contracts): add harness contract schemas + fixtures`.

### Task 2: `validate-contract.sh` (jq validator) + tests

**Files:** Create `harness/lib/common.sh`, `harness/validate-contract.sh`, `harness/tests/validate-contract_test.sh`, `harness/tests/run.sh`

**Interfaces:**
- Produces: `validate-contract.sh <kind> <file.json>` → exit 0 pass / non-zero + stderr reason. Consumed by the hook (Task 6) and transitions.

- [ ] **Step 1: Write failing test** `validate-contract_test.sh`: asserts valid fixtures exit 0; each invalid fixture exits non-zero; a duplicate-BR-ID requirement fixture fails with "duplicate BR-ID".
- [ ] **Step 2: Run** `bash harness/tests/run.sh` → FAIL (script missing).
- [ ] **Step 3: Implement** `common.sh` (`die`, `jq_get`, `require_fields`) and `validate-contract.sh`: per-kind required-field list, enum checks, and BR-ID uniqueness via `jq '[.requirements[].id] | ...'`.
- [ ] **Step 4: Run** `bash harness/tests/run.sh` → PASS.
- [ ] **Step 5: Commit** `feat(harness): jq contract validator + tests`.

### Task 3: Knowledge files

**Files:** Create `knowledge/ENGINEERING_PRINCIPLES.md`, `knowledge/TESTING_GUIDELINES.md`

- [ ] **Step 1:** Write `ENGINEERING_PRINCIPLES.md` from spec §5.3 (solve only the stated ask; reuse before build; evidence over assumption verified/inferred/unknown; map every change to a BR-ID; stop when acceptance passes; no unrelated refactor).
- [ ] **Step 2:** Write `TESTING_GUIDELINES.md` from spec §5.5 (equivalence partitioning, boundary-value, positive/negative/edge, BR-ID traceability matrix rule, question-only-on-business-flaw).
- [ ] **Step 3: Verify** both contain the traceability rule and the stop-when-done rule: `grep -l "traceab" knowledge/*.md`.
- [ ] **Step 4: Commit** `docs(knowledge): engineering principles + testing guidelines`.

### Task 4: `scope-gate.sh` (file-level) + tests

**Files:** Create `harness/scope-gate.sh`, `harness/tests/scope-gate_test.sh`

**Interfaces:**
- Produces: `scope-gate.sh <microtask.json> <changed-files-list>` → exit 0 if every changed file ∈ `allowed_files` ∪ `expected_outputs`; else non-zero listing the offending files. Reused by `integration.sh`.

- [ ] **Step 1: Write failing test:** changed file in `allowed_files` → pass; a file outside → fail naming it; a declared `expected_outputs` new file → pass.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** using `jq -r '.allowed_files[],.expected_outputs[]'` set-membership against the changed list.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(harness): file-level scope gate + tests`.

### Task 5: Scope-auditor (behavior-level) wrapper + tests

**Files:** Create `harness/scope-auditor/PROMPT.md`, `harness/scope-audit.sh`, `harness/tests/scope-audit_test.sh`

**Interfaces:**
- Produces: `scope-audit.sh <verdict.json>` where the orchestrator has run the auditor LLM pass (per `PROMPT.md`) emitting `{changes:[{ref,br_id|null}]}`. Script exits non-zero if any `br_id` is null/empty (unmapped behavior), recording the verdict into the trace.

- [ ] **Step 1:** Write `PROMPT.md`: independent reviewer maps each changed function/branch in a diff to an approved BR-ID or flags it unmapped; no fixing, no building; output the verdict JSON shape.
- [ ] **Step 2: Write failing test:** verdict with all `br_id` set → exit 0; verdict with one null → exit non-zero naming the ref.
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement** `scope-audit.sh` (jq: fail if `[.changes[]|select(.br_id==null or .br_id=="")]` non-empty).
- [ ] **Step 5: Run** → PASS.
- [ ] **Step 6: Commit** `feat(harness): behavior-level scope-auditor wrapper + prompt`.

### Task 6: Stage-advance hook + tests

**Files:** Create `harness/hooks/block-stage-advance.sh`, `harness/tests/hook_test.sh`

**Interfaces:**
- Consumes: a stage/state marker in `executions/<task-id>/state.json` + the relevant gate scripts.
- Produces: hook exits non-zero (blocks) until the current stage's gate passes. Wiring documented for the installer (Task 15).

- [ ] **Step 1: Write failing test:** given a state needing contract validation, hook fails when the contract is invalid and passes when valid.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** hook: read stage, run `validate-contract.sh`/`scope-gate.sh` as appropriate, propagate exit code.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(harness): stage-advance hook + tests`.

### Task 7: Rewrite the 5 agent files

**Files:** Modify `agents/{analyst,architect,developer,tester,task-observer}.md`

- [ ] **Step 1:** Analyst — emits `requirements.json` (BR-IDs, acceptance, out_of_scope, complexity); returns `open_questions` for relay; cannot add unapproved requirements.
- [ ] **Step 2:** Architect — emits `architecture.json` + micro-task DAG (disjoint `allowed_files`, acceptance copied from requirement); justifies new deps; returns `open_questions`.
- [ ] **Step 3:** Developer — blind-builds its micro-task only; never asks; returns `blocker` on ambiguity or undeclared-file need; emits `implementation.json`.
- [ ] **Step 4:** Tester — designs cases from requirement+architecture+business reqs (not dev code), per `TESTING_GUIDELINES.md`; full BR-ID traceability; `flaw` only on business-requirement defect; emits `test-report.json`.
- [ ] **Step 5:** Task-observer — reads traces + contracts (not transcripts); writes evidence-based `07-observer-report.md` with root-cause; runs the feedback+upskill gate.
- [ ] **Step 6: Verify** each file states its contract output, its question permission, and "load orcs-harness skill first": `grep -L "orcs-harness" agents/*.md` → empty.
- [ ] **Step 7: Commit** `refactor(agents): rewrite stage agents for the harness contract model`.

### Task 8: Rewrite the `orcs-harness` skill as the harness contract

**Files:** Modify `skills/orcs-harness/skill.md`

- [ ] **Step 1:** Rewrite to the orchestrator (C1) contract: role/question matrix (§5.1), contract handoffs, gates + hooks (§5.8), stage transitions (§5.11), human contract-review gate (§5.9), fast-path (§5.10), feedback loop (§6). Keep the skill name `orcs-harness`; title it "Orcs Harness".
- [ ] **Step 2: Verify** the skill names all gates and the transition order: `grep -E "scope-gate|scope-audit|validate-contract|contract-review|fast-path" skills/orcs-harness/skill.md`.
- [ ] **Step 3: Commit** `refactor(skill): orcs-harness becomes the harness contract`.

---

## Phase 2 — Parallelism

### Task 9: `budgets.sh` + tests

**Files:** Create `harness/budgets.sh`, `harness/tests/budgets_test.sh`

**Interfaces:** `budgets.sh <state.json> <counter-name>` increments + checks against the spec §5.6 limits; exit non-zero (stop-and-report) on breach.

- [ ] **Step 1: Write failing test:** under-limit → pass; at limit+1 → fail naming the counter.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (jq read/increment/compare). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(harness): execution budgets + tests`.

### Task 10: `complexity-tripwire.sh` + tests

**Files:** Create `harness/complexity-tripwire.sh`, `harness/tests/tripwire_test.sh`

**Interfaces:** `complexity-tripwire.sh <microtask.json> <changed-count> <deps-added>` → exit non-zero (escalate to full path) if `complexity==low` and (files > N or deps>0 or budget exceeded).

- [ ] **Step 1: Write failing test** (Review-Focus item 1): low + many files → escalate; low + within limits → stay.
- [ ] **Step 2–4:** Run→FAIL, implement, Run→PASS.
- [ ] **Step 5: Commit** `feat(harness): fast-path complexity trip-wire + tests`.

### Task 11: `dag-ready.sh` + tests

**Files:** Create `harness/dag-ready.sh`, `harness/tests/dag_test.sh`

**Interfaces:** `dag-ready.sh <dag.json>` → prints the ready-task ids (deps satisfied) and exits non-zero if any two ready tasks share an `allowed_files` entry (must be serialized).

- [ ] **Step 1: Write failing test** (Review-Focus item 3): independent tasks both ready; two with overlapping files → refuse/serialize.
- [ ] **Step 2–4:** Run→FAIL, implement (jq dependency resolution + pairwise file-set intersection), Run→PASS.
- [ ] **Step 5: Commit** `feat(harness): DAG ready-set + disjoint-file guard + tests`.

### Task 12: `integration.sh` + tests

**Files:** Create `harness/integration.sh`, `harness/tests/integration_test.sh`

**Interfaces:** `integration.sh <task-id> <branch>` runs: scope-gate → scope-audit → lint hook (if configured) → per-branch tests → merge → integration tests. Exit non-zero + reason on any failure; prints `REDISPATCH <microtask>` on a fixable failure.

- [ ] **Step 1: Write failing test** in a throwaway fixture git repo + worktree: clean branch merges + integration passes → exit 0; out-of-scope edit → reject (Review-Focus 2); failing integration test → reject with REDISPATCH (Review-Focus 5).
- [ ] **Step 2–4:** Run→FAIL, implement, Run→PASS.
- [ ] **Step 5: Commit** `feat(harness): integration manager + tests`.

---

## Phase 3 — Learning Tier 1

### Task 13: `trace.sh` + tests

**Files:** Create `harness/trace.sh`, `harness/tests/trace_test.sh`

**Interfaces:** `trace.sh <task-id> <field> <value>` appends deterministic fields (timings, iteration counts, rework cycles, scope violations, blocker counts, test pass/fail) to `executions/<task-id>/execution-trace.json`. Token/cost fields stay null (deferred).

- [ ] **Step 1: Write failing test:** appending two fields yields a valid JSON trace containing both; token fields remain null.
- [ ] **Step 2–4:** Run→FAIL, implement (jq merge-write), Run→PASS.
- [ ] **Step 5: Commit** `feat(harness): deterministic execution-trace writer + tests`.

### Task 14: Observer report + feedback/upskill helper

**Files:** Create `harness/upskill-apply.sh`, `executions/README.md`, `harness/tests/upskill_test.sh`; template in task-observer agent (Task 7) referenced here.

**Interfaces:** `upskill-apply.sh <report.md>` requires an approved `## User Feedback` block + an owner-approval marker before it `git add`s the agreed asset changes; refuses without approval.

- [ ] **Step 1: Write failing test:** report without approval marker → refuse (exit non-zero); with marker → stages the listed files.
- [ ] **Step 2–4:** Run→FAIL, implement, Run→PASS.
- [ ] **Step 5:** Write `executions/README.md` (per-run layout: contracts + trace + state).
- [ ] **Step 6: Commit** `feat(harness): per-project upskill apply gate + executions layout`.

---

## Repo plumbing & apply

### Task 15: Update installers

**Files:** Modify `install.sh`, `install.ps1`

- [ ] **Step 1:** Make both copy `harness/`, `contracts/`, `knowledge/`, `executions/` into the target (global or `--project`) alongside agents + the skill; register the hook; keep the 6-skill install + CLAUDE.md block.
- [ ] **Step 2: Verify** `bash -n install.sh` and dry-run logic path lists the new dirs: `grep -E "harness|contracts|knowledge" install.sh install.ps1`.
- [ ] **Step 3: Commit** `feat(install): lay down harness, contracts, knowledge, executions`.

### Task 16: Update readme + instructions

**Files:** Modify `readme.md`, `instructions.md`

- [ ] **Step 1:** Rewrite "pipeline" framing → "harness"; document contracts, gates, parallel devs + one tester, review gate, fast-path, upskill loop; keep install/verify/uninstall accurate to the new dirs.
- [ ] **Step 2: Verify** no stale "pipeline-only" claims: `grep -n "pipeline" readme.md instructions.md` reviewed.
- [ ] **Step 3: Commit** `docs: rewrite readme + instructions for the harness`.

### Task 17: Apply to system + whole-branch review

- [ ] **Step 1:** Run the full test suite: `bash harness/tests/run.sh` → all PASS.
- [ ] **Step 2:** Apply globally: `./install.sh` (auto-apply, as the owner asked). Capture output.
- [ ] **Step 3: Verify** agents + skill + harness present under `~/.claude` and the Skill picker resolves `orcs-harness`; the global CLAUDE.md block is intact (not duplicated).
- [ ] **Step 4:** Invoke `superpowers:requesting-code-review` for a whole-branch review on the most capable model; address blocking findings.
- [ ] **Step 5:** Leave the branch `harness-redesign` committed for the owner to push (no push without explicit ask).
