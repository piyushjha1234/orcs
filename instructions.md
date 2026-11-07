# Installing Orcs

Orcs is distributed as this repo and installed into Claude Code config dirs. It installs **6 official community skills**, one harness contract skill (`orcs-pipeline`), the five agents, and the **harness kit** — deterministic gate scripts, contract schemas, and knowledge files — plus a Claude Code hook that enforces stage order.

## What gets installed

| Piece | Where | Scope |
|---|---|---|
| 6 external skills (superpowers, find-skills, caveman, claude-mem, impeccable, task-observer) | `~/.claude` (+ plugins) | **global** |
| 5 Orcs agents (analyst, architect, developer, tester, task-observer) | `<target>/.claude/agents/` | global or `--project` |
| `orcs-pipeline` skill (the harness contract) | `<target>/.claude/skills/` | global or `--project` |
| Harness kit: `harness/` gates, `contracts/` schemas, `knowledge/` principles + testing guidelines | `<target>/.claude/orcs/` | global or `--project` |
| Stage-advance hook (PreToolUse, matcher `Agent\|Task`) | `<target>/.claude/settings.json` (merged; backup kept) | global or `--project` |
| Caveman + task-observer enforcement block | `~/.claude/CLAUDE.md` | **global** |
| Task-specific skills discovered per project | `<project>/.claude/skills/` | **project** (installed at run time by the agents, with user approval) |

## Requirements

- `jq` and `git` — always (the harness gates use them). On Windows, Git for Windows (bash) too.
- Node **≥ 22.20**, `npx`, and the `claude` CLI (Claude Code) on PATH — for the skill installs.
- Network access to npm and GitHub (the skills come from their official repos).

Both installers **preflight** these and fail early with clear guidance if anything is missing.

## Install

Two equivalent installers ship in this repo — `install.sh` (macOS/Linux) and `install.ps1` (Windows). They do exactly the same thing.

### macOS / Linux (`install.sh`)

```bash
git clone <this-repo> && cd orcs
chmod +x install.sh

./install.sh                        # global (default)
./install.sh --project /path/to/project   # agents, skill, kit + hook into project; skills+CLAUDE.md stay global
./install.sh --skip-skills          # only refresh agents, skill, kit + hook
```

### Windows (`install.ps1`, PowerShell)

```powershell
git clone <this-repo>; cd orcs

# -ExecutionPolicy Bypass runs the script without changing your machine's policy
powershell -ExecutionPolicy Bypass -File .\install.ps1
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Project C:\path\to\project
powershell -ExecutionPolicy Bypass -File .\install.ps1 -SkipSkills
```

> Config lives at `%USERPROFILE%\.claude` on Windows (equivalent to `~/.claude`). The PowerShell installer writes the task-observer pinned paths as absolute Windows paths.

Both installers:
1. install the 6 skills from their official sources (idempotent; `caveman` is scoped to just the `caveman` skill, not the whole repo bundle),
2. remove the legacy home-grown Orcs skills from the user skills dir,
3. copy the 5 agents + the `orcs-pipeline` skill,
4. copy the harness kit to `<target>/orcs/` and record this repo's path in `orcs/SOURCE_REPO` (the upskill loop stages approved changes here, so you can push them),
5. merge the stage-advance hook into `<target>/settings.json` (idempotent; timestamped backup),
6. append the global CLAUDE.md enforcement block (only if not already present).

## Manual steps the installer can't do in a terminal

- **`/impeccable init`** — run once inside a Claude Code chat to set up design context for the developer's frontend work.
- **claude-mem sign-in (optional)** — only needed for cloud sync / the Pro trial; local memory works without it. Start its worker with `npx claude-mem start` if you want the live viewer.
- **task-observer** — verify activation in a **new** session (the installing session can't prove it). For strict enforcement, install the session-start hook described in `~/.claude/skills/task-observer/references/environments.md`.

## Verify

1. `npx skills list` and `claude plugin list` show the skills; the Skill picker resolves `find-skills`, `caveman`, `task-observer`, `impeccable`, `superpowers`, `orcs-pipeline`.
2. Agent picker shows analyst, architect, developer, tester, task-observer (no retro).
3. `bash ~/.claude/orcs/harness/tests/run.sh` prints `ALL HARNESS TESTS PASSED`.
4. `/hooks` in Claude Code lists the PreToolUse `Agent|Task` hook running `block-stage-advance.sh`.
5. Dry run in a scratch project: `bash ~/.claude/orcs/harness/init-run.sh ORCS-001`, give a one-line requirement, and confirm the main session dispatches the analyst, relays its questions, and shows you `requirement.json` for approval. Try dispatching the architect before approving — the hook must block it.

## Uninstall

macOS / Linux:

```bash
# agents + skill + kit
rm -f ~/.claude/agents/{analyst,architect,developer,tester,task-observer}.md
rm -rf ~/.claude/skills/orcs-pipeline ~/.claude/orcs
# external skills
npx skills remove find-skills caveman task-observer impeccable -g
claude plugin uninstall superpowers@superpowers-marketplace
npx claude-mem uninstall
# then delete the <!-- orcs:global:start/end --> block from ~/.claude/CLAUDE.md
# and the PreToolUse "Agent|Task" entry running block-stage-advance.sh from ~/.claude/settings.json
```

Windows (PowerShell):

```powershell
$c = "$env:USERPROFILE\.claude"
'analyst','architect','developer','tester','task-observer' | ForEach-Object { Remove-Item -Force "$c\agents\$_.md" }
Remove-Item -Recurse -Force "$c\skills\orcs-pipeline", "$c\orcs"
npx skills remove find-skills caveman task-observer impeccable -g
claude plugin uninstall superpowers@superpowers-marketplace
npx claude-mem uninstall
# then delete the <!-- orcs:global:start/end --> block from %USERPROFILE%\.claude\CLAUDE.md
# and the PreToolUse "Agent|Task" block-stage-advance.sh entry from %USERPROFILE%\.claude\settings.json
```
