#!/usr/bin/env bash
#
# Orcs installer — sets up the token-lean, skill-driven Orcs pipeline:
#   * installs 6 official community skills GLOBALLY (user level)
#   * removes the legacy home-grown Orcs skills
#   * installs the Orcs agents + the summarised orcs-pipeline skill
#   * appends the global CLAUDE.md enforcement block (caveman + task-observer)
#
# Usage:
#   ./install.sh                 # global install -> ~/.claude
#   ./install.sh --project DIR   # agents + orcs-pipeline -> DIR/.claude
#                                #   (the 6 skills + CLAUDE.md stay global)
#   ./install.sh --skip-skills   # don't (re)install the 6 external skills
#   ./install.sh --help
#
# Requirements: node >= 22.20, npx, and the `claude` CLI on PATH.
# Run from inside a clone of the Orcs repo (must contain agents/ and skills/).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_AGENTS="$SCRIPT_DIR/agents"
SRC_SKILLS="$SCRIPT_DIR/skills"

USER_CLAUDE="$HOME/.claude"
TARGET_BASE="$USER_CLAUDE"
SKIP_SKILLS=0

usage() { sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'; }

# --- parse args ---
while [ $# -gt 0 ]; do
  case "$1" in
    ""|--global) TARGET_BASE="$USER_CLAUDE" ;;
    --project)
      [ -n "${2:-}" ] || { echo "error: --project needs a directory" >&2; exit 1; }
      TARGET_BASE="$2/.claude"; shift ;;
    --skip-skills) SKIP_SKILLS=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown argument '$1'" >&2; usage; exit 1 ;;
  esac
  shift
done

[ -d "$SRC_AGENTS" ] || { echo "error: $SRC_AGENTS not found — run from inside the Orcs repo" >&2; exit 1; }
[ -d "$SRC_SKILLS" ] || { echo "error: $SRC_SKILLS not found — run from inside the Orcs repo" >&2; exit 1; }

# --- preflight: required tooling (only when we actually install skills) ---
preflight() {
  local ok=1
  if ! command -v node >/dev/null 2>&1; then
    echo "error: node not found. Install Node >= 22.20 (https://nodejs.org)." >&2; ok=0
  else
    # require major>=22 and, on major 22, minor>=20
    local v; v="$(node -p 'process.versions.node')"
    local maj min; maj="${v%%.*}"; min="${v#*.}"; min="${min%%.*}"
    if [ "$maj" -lt 22 ] || { [ "$maj" -eq 22 ] && [ "$min" -lt 20 ]; }; then
      echo "error: Node $v is too old; need >= 22.20 (npx skills requires it)." >&2; ok=0
    fi
  fi
  command -v npx   >/dev/null 2>&1 || { echo "error: npx not found (ships with Node)." >&2; ok=0; }
  command -v claude >/dev/null 2>&1 || {
    echo "error: 'claude' CLI not found. Install Claude Code first (https://claude.com/claude-code)" >&2
    echo "       — it must be present so the skills CLI can detect the 'claude-code' agent." >&2; ok=0; }
  [ "$ok" -eq 1 ] || { echo "Preflight failed. Fix the above and re-run (or use --skip-skills)." >&2; exit 1; }
}
[ "$SKIP_SKILLS" -eq 0 ] && preflight

echo "Installing Orcs (agents+pipeline -> $TARGET_BASE)"

# --- 1. the 6 global skills (official sources only) ---
if [ "$SKIP_SKILLS" -eq 0 ]; then
  echo "== Installing the 6 global skills =="
  npx -y skills@latest add vercel-labs/skills --skill find-skills -g -y --copy -a claude-code
  # caveman repo bundles many skills; keep only 'caveman'
  npx -y skills@latest add JuliusBrussee/caveman --skill caveman -g -y --copy -a claude-code
  npx -y skills@latest add rebelytics/one-skill-to-rule-them-all --skill task-observer -g -y --copy -a claude-code
  npx -y impeccable@latest install --providers=claude --scope=global
  claude plugin marketplace add obra/superpowers-marketplace || true
  claude plugin install superpowers@superpowers-marketplace || true
  npx -y claude-mem@latest install
else
  echo "== Skipping the 6 skill installs (--skip-skills) =="
fi

# --- 2. remove legacy home-grown Orcs skills at user level ---
echo "== Removing legacy Orcs skills from $USER_CLAUDE/skills =="
for s in research-best-practices options-and-confirm write-handover-doc \
         cost-estimation threat-and-break use-learned-skill agent-self-improve \
         analyst-skills architect-skills developer-skills tester-skills retro-skills; do
  rm -rf "$USER_CLAUDE/skills/$s"
done

# --- 3. Orcs agents + the summarised orcs-pipeline skill ---
DST_AGENTS="$TARGET_BASE/agents"
DST_SKILLS="$TARGET_BASE/skills"
mkdir -p "$DST_AGENTS" "$DST_SKILLS"
cp "$SRC_AGENTS"/{analyst,architect,developer,tester,task-observer}.md "$DST_AGENTS/"
rm -f "$DST_AGENTS/retro.md"
cp -R "$SRC_SKILLS/orcs-pipeline" "$DST_SKILLS/"
echo "  agents -> $DST_AGENTS (5)"
echo "  skill  -> $DST_SKILLS/orcs-pipeline"

# --- 4. global CLAUDE.md enforcement block (idempotent) ---
CLAUDE_MD="$USER_CLAUDE/CLAUDE.md"
mkdir -p "$USER_CLAUDE"
if grep -q "orcs:global:start" "$CLAUDE_MD" 2>/dev/null; then
  echo "  CLAUDE.md orcs block already present — not duplicated"
else
  cat >> "$CLAUDE_MD" <<'EOF'

<!-- orcs:global:start -->
## Caveman voice — global, no exceptions

Operate in **caveman mode** for all natural-language output in every session: invoke the `caveman` skill and keep its terse, answer-first voice — every technical fact kept, all fluff gone. This applies to conversation and to prose in any document/handover you write.

- **Never** apply caveman to code, config, markup, data files, convention-bound commit messages, or any deliverable artifact — those stay correct and conventional.
- Stays on until the user says "stop caveman" / "normal mode".

## Task-observer activation

Before the first tool call of any session — and before writing or proposing a plan — invoke the `task-observer` skill AND run its Session Start Protocol (loading the file is not enough; the protocol is a separate step). Any turn that will involve a tool call counts. After each task, list the observation records written this session and report a one-line summary (or "none logged" with a reason per correction/incident).

Pinned paths (never resolve from the current working directory):
- Workspace root: ~/.claude/task-observer-workspace
- Skill directory: ~/.claude/skills/task-observer
- Projects root: ~/Desktop/assets

A subagent dispatched by a session already running task-observer does not re-run it; it writes nothing and puts findings in its report. For stricter enforcement, install the session-start hook from ~/.claude/skills/task-observer/references/environments.md.
<!-- orcs:global:end -->
EOF
  echo "  CLAUDE.md -> appended orcs global block"
fi

echo
echo "Done. Pipeline agents: analyst, architect, developer, tester, task-observer."
echo "Global skills: find-skills, caveman, task-observer, impeccable, superpowers, claude-mem, orcs-pipeline."
