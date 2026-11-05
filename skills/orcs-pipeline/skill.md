---
name: orcs-pipeline
description: The Orcs delivery-pipeline contract — stage order, per-project docs/ layout, the skill-driven flow (superpowers → find-skills → caveman → claude-mem), handoff rules, and the hard gates. Load this FIRST in any Orcs agent (analyst, architect, developer, tester, task-observer) before doing stage work.
---

# Orcs Pipeline Contract (summarised)

Orcs turns a requirement into a tested solution through staged agents. Each agent runs in a **fresh session**, receives only the prior stage's **claude-mem handover summary doc(s)** (never the full conversation), and writes its own handover. Goal: maximum quality, minimum wasted tokens.

## Stages & handover chain

1. **Analyst** — input: user requirement. Output: `docs/01-requirements.md` + `docs/02-analyst-handover.md`.
2. **Architect** — input: `02`. Output: `docs/03-architecture.md` + `docs/04-architect-handover.md`.
3. **Developer** — input: `02` + `04` (analyst + architect summaries). Output: code + `docs/05-dev-handover.md`.
4. **Tester** — input: `02` + `04` + `05` (analyst + architect + developer summaries). Output: `docs/06-test-report.md`.
5. **Task-observer** — runs throughout (session observation) and at project end reviews `01`–`06` + code → `docs/07-observer-notes.md`; proposes **user-level** skills, installs only on user confirmation.

The user drives the pipeline stage by stage; no agent silently invokes the next. Each stage starts a new session so the next agent gets only the handover docs.

## The per-stage flow (every delivery agent follows this)

1. **superpowers kicks in.** On receiving the ask/handover, use the `superpowers` skill to research thoroughly and decide the next tasks. Ask the user **every** question during the thinking stage; get answers before proceeding. Assume nothing.
2. **Discover skills.** Decide which task-specific skills this stage needs, find them with the `find-skills` skill, present them to the user, get approval, then install **at project level only** (`<project>/.claude/skills/`) — never user level. Then work.
3. **Load this contract** (orcs-pipeline), then do the stage work.
4. **Handover.** Use `claude-mem` to summarise the stage into a complete handover doc the next agent can start from with zero missing detail.
5. **Gate.** Confirm with the user before handing off.

## Hard gates (non-negotiable)

1. **Never assume** — ambiguity is a question, not a guess.
2. **Research before deciding** — dilemmas become options with pros/cons (via `superpowers`); never silently pick.
3. **Always confirm** — present options (tag **Required** = goal fails without it / **Optional** = upside), stop, and wait for explicit user OK at every stage boundary and every mid-stage dilemma. "proceed"/"looks good" passes a gate; silence does not. Record the choice in the stage doc.
4. **Document the handoff** — every stage writes its doc(s) in `docs/` before handing off.
5. **Stack-agnostic** — choose the stack per project via research, not habit.

## Output discipline (all agents)

- **caveman everywhere:** all conversation and handover-doc prose use the `caveman` skill — terse, answer-first, every technical fact kept. Never apply caveman to code, config, or deliverable artifacts; those stay correct and conventional.
- No unnecessary steps, filler text, assumptions, visible thinking, or decorative comments. Code: short, accurate, only meaningful comments.
- Frontend work: the developer always uses the `impeccable` skill (plus any relevant discovered skill) so UI is not AI slop.

## Handover doc rules

- Write real files in `<project>/docs/`, not just chat output.
- Each handover summary is self-contained: the next agent acts only on what is written.
- Reference prior-stage docs by path so the chain is traceable.
- If a required input doc is missing/incomplete, stop and tell the user — never reconstruct by assumption.
