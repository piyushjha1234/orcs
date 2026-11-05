# Orcs — a token-lean, skill-driven delivery pipeline

Orcs turns a requirement into a tested, high-quality solution through specialist Claude Code agents. It is built to **save tokens**: every agent runs in a fresh session, gets only a compressed handover (not the whole conversation), talks in terse "caveman" voice, and discovers only the skills it actually needs per project.

```
Requirement ─▶ Analyst ─▶ Architect ─▶ Developer ─▶ Tester
                 │            │            │            │
             02-analyst-  04-architect- 05-dev-     06-test-
             handover     handover      handover    report
                 └────────────┴─────── Task Observer ───────┘
                        (observes every stage; reviews + suggests skills at the end)
```

## The agents

| Stage | Agent | Does | Writes |
|---|---|---|---|
| 1 | **analyst** | Researches (superpowers), asks every question, drafts requirements + epics | `01-requirements.md`, `02-analyst-handover.md` |
| 2 | **architect** | Designs per epic (cost/scale/TTM/UX), offers options, sequences stories | `03-architecture.md`, `04-architect-handover.md` |
| 3 | **developer** | Builds minimally & correctly, uses impeccable on frontend, breaks its own work | code, `05-dev-handover.md` |
| 4 | **tester** | Executes positive/negative/edge/API/UI/stress + break-it; classifies bugs | `06-test-report.md` |
| — | **task-observer** | Watches every stage, reviews the finished project, proposes user-level skills | `07-observer-notes.md` |

All deliverables land in the project's own `docs/` folder.

## The skills

Six official community skills do the heavy lifting (installed **globally**, never hand-generated):

| Skill | Role | Source |
|---|---|---|
| **superpowers** | kicks in at every stage: research + ask all questions before acting | `obra/superpowers-marketplace` |
| **find-skills** | each agent discovers task-specific skills, installs them **project-level** with user approval | `vercel-labs/skills` |
| **caveman** | terse, answer-first voice for all prose (never for code) | `JuliusBrussee/caveman` |
| **claude-mem** | compresses each stage into the handover the next agent starts from | `thedotmack/claude-mem` |
| **impeccable** | the developer's frontend quality gate — no AI slop | `pbakaus/impeccable` |
| **task-observer** | observes sessions, proposes new user-level skills at project end | `rebelytics/one-skill-to-rule-them-all` |

Plus one summarised in-repo skill, **`orcs-pipeline`**, the contract every agent loads first.

## How to run a project

The user drives the pipeline stage by stage; each agent stops at a hard gate for sign-off.

1. Give the **analyst** your requirement. It researches, asks everything, and (with your OK) installs any project-level skills it needs, then writes its handover.
2. Start a **new session** and run the **architect** on the analyst handover. Choose among the options it offers.
3. New session → **developer** (gets analyst + architect handovers). Approve the build.
4. New session → **tester** (gets analyst + architect + developer handovers). Read `06-test-report.md`.
5. Run **task-observer** at the end; it proposes user-level skills and installs them only on your confirmation.

## The hard gates

- **Never assume** — ambiguity becomes a question.
- **Research before deciding** — dilemmas become options with pros/cons (superpowers).
- **Always confirm** — nothing advances past a gate without your explicit OK.
- **Document the handoff** — every stage writes its doc (claude-mem summarised).

## Install

```bash
# macOS / Linux
git clone <this-repo> && cd orcs
./install.sh                 # global
./install.sh --project DIR   # agents + orcs-pipeline into DIR/.claude (skills stay global)
```

```powershell
# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Requires Node ≥ 22.20, `npx`, and the `claude` CLI. See `instructions.md` for details.
