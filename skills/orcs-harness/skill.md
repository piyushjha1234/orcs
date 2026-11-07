---
name: orcs-harness
description: The Orcs Harness contract. The main session is the orchestrator; stage agents (analyst, architect, developer ×N, tester ×N, task-observer) are subagents that hand off through owner-approved JSON contracts checked by deterministic gates and hooks. Covers roles, question rights, handbacks, token discipline and hard rules; the orchestrator's run sequence, gates and budgets live in references/orchestrator.md. Load this FIRST in any Orcs session or agent.
---

# Orcs Harness

**Agents are intelligent; the harness is authoritative.** Rules that matter are enforced by
scripts and hooks, not by an agent's good intentions. Goal: the same request yields the
same delivered scope on a weak or a strong model — exactly what was asked, nothing assumed,
nothing extra. When a task is beyond the model, the harness stops and reports the gap.

**Main session (orchestrator, no agent named): read `references/orchestrator.md` in this
skill's directory before step 0** — run sequence, gates, budgets, tracing. Subagents skip it.

## Kit layout
The kit lives at `~/.claude/orcs/` (or `<project>/.claude/orcs/`), linked into the project as
`.orcs/`: `.orcs/harness/*.sh` (gates), `.orcs/contracts/*.schema.json`,
`.orcs/knowledge/*.md`. Run state: `executions/<task-id>/`.

## Roles and question rights

| Role | Runs as | May ask the owner? |
|---|---|---|
| Orchestrator | **main session** | Yes — the only one that can |
| Analyst | subagent | Yes, via `open_questions` relayed by the orchestrator |
| Architect | subagent | Yes, via `open_questions` (design options) relayed |
| Developer ×N | subagents, parallel, one per micro-task | **Never** — returns a `blocker` |
| Scope auditor | subagent (general-purpose + `.orcs/harness/scope-auditor/PROMPT.md`) | No |
| Tester ×N | subagents, parallel, one per BR shard, after integration | Only `flaws[]` for business-requirement defects |
| Task Observer | subagent, project end | Report + owner feedback block |

Subagents cannot prompt the user. Every subagent ends with an `ORCS-HANDBACK` block; the
orchestrator parses it mechanically.

## Token discipline (every agent)
- **Final message = the `ORCS-HANDBACK` block only**, at most ~20 lines. Details, evidence and
  reasoning go in the files you write; the handback names their paths.
- **Read only what your inputs name.** Open other files only when a step needs them; read the
  relevant part of a large file, not all of it. Never paste file contents back into chat.
- **Command output: keep the decisive part.** Run tests and builds with output to a file or
  through `tail`; quote the shortest line that proves pass or fail.
- **No re-reading** a file you already have unless it changed.
- Token thrift never overrides correctness: if a step needs a file, read it.

## Skills each stage uses
`superpowers` (research before deciding) · `find-skills` (task skills, project-level, owner
approves) · `caveman` (all prose; never code or contracts) · companion docs `docs/01`, `03`, `06` (plain Markdown; the JSON contract is the source of truth) · `impeccable` (all
frontend work) · `task-observer` (the end-of-project report + upskill loop).

## Hard rules
1. Never assume — unknowns become `open_questions` or a `blocker`.
2. Deliver only approved BR-IDs. Ideas for more scope are suggestions for the owner, not work.
3. Every contract is reviewed and approved by the owner before the next stage.
4. Fail loud: on a gate failure or a budget breach, stop, keep state, report. Never edit an
   approved contract, a gate script, or a hook to make a step pass.
5. Stack-agnostic: choose the stack per project by research, not habit.
