#!/usr/bin/env bash
#
# Orcs installer — sets up the Orcs Harness:
#   * installs 6 official community skills GLOBALLY (user level)
#   * removes the legacy home-grown Orcs skills
#   * installs the Orcs agents + the orcs-harness (harness contract) skill
#   * installs the harness kit (gates, contracts, knowledge) -> <target>/orcs
#   * registers the stage-advance hook (PreToolUse, Agent|Task) in <target>/settings.json
#   * appends the global CLAUDE.md enforcement block (caveman + task-observer)
#
# Usage:
#   ./install.sh                 # global install -> ~/.claude
#   ./install.sh --project DIR   # agents + skill + kit + hook -> DIR/.claude
#                                #   (the 6 skills + CLAUDE.md stay global)
#   ./install.sh --skip-skills   # don't (re)install the 6 external skills
#   ./install.sh --help
#
# Requirements: jq and git always; node >= 22.20, npx, and the `claude` CLI for the skills.
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
for c in jq git; do command -v "$c" >/dev/null 2>&1 || { echo "error: $c not found — the harness gates need it (macOS: brew install $c)." >&2; exit 1; }; done

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

# --- 3. Orcs agents + the summarised orcs-harness skill ---
DST_AGENTS="$TARGET_BASE/agents"
DST_SKILLS="$TARGET_BASE/skills"
mkdir -p "$DST_AGENTS" "$DST_SKILLS"
cp "$SRC_AGENTS"/{analyst,architect,developer,tester,task-observer}.md "$DST_AGENTS/"
rm -f "$DST_AGENTS/retro.md"
cp -R "$SRC_SKILLS/orcs-harness" "$DST_SKILLS/"
echo "  agents -> $DST_AGENTS (5)"
echo "  skill  -> $DST_SKILLS/orcs-harness"

# --- 3b. harness kit (gates, contracts, knowledge) ---
KIT="$TARGET_BASE/orcs"
rm -rf "$KIT"; mkdir -p "$KIT"
cp -R "$SCRIPT_DIR/harness" "$SCRIPT_DIR/contracts" "$SCRIPT_DIR/knowledge" "$KIT/"
find "$KIT/harness" -name '*.sh' -exec chmod +x {} +
echo "$SCRIPT_DIR" > "$KIT/SOURCE_REPO"
echo "  kit    -> $KIT (harness, contracts, knowledge)"

# --- 3c. stage-advance hook (idempotent merge into settings.json) ---
SETTINGS="$TARGET_BASE/settings.json"
if [ "$TARGET_BASE" = "$USER_CLAUDE" ]; then HOOK_CMD="bash \"$KIT/harness/hooks/block-stage-advance.sh\""
else HOOK_CMD='bash "$CLAUDE_PROJECT_DIR/.claude/orcs/harness/hooks/block-stage-advance.sh"'; fi  # portable for a shared project
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
jq -e 'type=="object" and ((.hooks // {}) | type=="object") and ((.hooks.PreToolUse // []) | type=="array")' "$SETTINGS" >/dev/null 2>&1 \
  || { echo "error: $SETTINGS has an unexpected shape (need an object; hooks an object; hooks.PreToolUse an array) — fix it, then re-run. Hook NOT installed." >&2; exit 1; }
cp "$SETTINGS" "$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"
tmp="$(mktemp)"
if ! jq --arg cmd "$HOOK_CMD" '
  .hooks.PreToolUse = ([ (.hooks.PreToolUse // [])[]
      | if has("hooks") then
          (.hooks = [ (.hooks // [])[] | select((.command // "") | test("block-stage-advance.sh") | not) ])
          | select((.hooks | length) > 0)
        else . end ]
    + [ {matcher: "Agent|Task", hooks: [ {type: "command", command: $cmd} ]} ])' "$SETTINGS" > "$tmp"; then
  rm -f "$tmp"; echo "error: could not merge the hook into $SETTINGS — settings left unchanged. Hook NOT installed." >&2; exit 1
fi
mv "$tmp" "$SETTINGS"
echo "  hook   -> $SETTINGS (PreToolUse Agent|Task; backup kept)"

# --- 4. global CLAUDE.md enforcement block (installer-owned; replaced in place on re-install) ---
CLAUDE_MD="$USER_CLAUDE/CLAUDE.md"
mkdir -p "$USER_CLAUDE"
BLOCK="$(mktemp)"
cat > "$BLOCK" <<'EOF'
<!-- orcs:global:start -->
## Caveman voice — global, no exceptions

Operate in **caveman mode** for all natural-language output in every session: invoke the `caveman` skill and keep its terse, answer-first voice — every technical fact kept, all fluff gone. This applies to conversation and to prose in any document/handover you write.

- **Never** apply caveman to code, config, markup, data files, convention-bound commit messages, or any deliverable artifact — those stay correct and conventional.
- Stays on until the user says "stop caveman" / "normal mode".

## Task-observer activation

A SessionStart hook runs the task-observer session-start scan (`session-start-scan.sh`) and puts its output in context: that output is the Session Start Protocol's storage probe and scan — do not re-run them. The full `task-observer` skill is large (~50 KB), so load it only when it is needed: before writing an observation, at a todo checkpoint that has something to log, when you act on a `DUE:`, `GAP:` or `NOTE:` line from the scan, or when the user asks for a review. Observation still runs all session — a user correction, your own rule violation, or a workaround after a denial is logged in the same turn, loading the skill at that moment. After each task, list the observation records written this session and report a one-line summary (or "none logged" with a reason per correction/incident).

If no scan output from the hook is in context (hook missing or failed), fall back: before the first tool call, invoke the `task-observer` skill and run its Session Start Protocol.

Pinned paths (never resolve from the current working directory):
- Workspace root: ~/.claude/task-observer-workspace
- Skill directory: ~/.claude/skills/task-observer
- Projects root: ~/Desktop/assets

A subagent dispatched by a session already running task-observer does not re-run it; it writes nothing and puts findings in its report.
<!-- orcs:global:end -->
EOF
if grep -q "orcs:global:start" "$CLAUDE_MD" 2>/dev/null; then
  cp "$CLAUDE_MD" "$CLAUDE_MD.bak.$(date +%Y%m%d%H%M%S)"
  tmp="$(mktemp)"
  awk -v blk="$BLOCK" '
    /<!-- orcs:global:start -->/ { while ((getline l < blk) > 0) print l; skip = 1; next }
    /<!-- orcs:global:end -->/   { skip = 0; next }
    !skip' "$CLAUDE_MD" > "$tmp" && mv "$tmp" "$CLAUDE_MD"
  echo "  CLAUDE.md -> orcs global block replaced in place (backup kept)"
else
  { echo; cat "$BLOCK"; } >> "$CLAUDE_MD"
  echo "  CLAUDE.md -> appended orcs global block"
fi
rm -f "$BLOCK"

# --- 4b. task-observer session-start scan as a user-level SessionStart hook (idempotent) ---
# Runs the scan without loading the ~50 KB task-observer skill into every session; the
# CLAUDE.md block above loads the skill only when an observation is written or reviewed.
USER_SETTINGS="$USER_CLAUDE/settings.json"
SCAN="$USER_CLAUDE/skills/task-observer/scripts/session-start-scan.sh"
WS="$USER_CLAUDE/task-observer-workspace"
SCAN_CMD="[ ! -f \"$SCAN\" ] || [ ! -d \"$WS\" ] || bash \"$SCAN\" \"$WS\""
[ -f "$USER_SETTINGS" ] || echo '{}' > "$USER_SETTINGS"
if jq -e 'type=="object" and ((.hooks // {}) | type=="object") and ((.hooks.SessionStart // []) | type=="array")' "$USER_SETTINGS" >/dev/null 2>&1; then
  [ "$USER_SETTINGS" = "$SETTINGS" ] || cp "$USER_SETTINGS" "$USER_SETTINGS.bak.$(date +%Y%m%d%H%M%S)"
  tmp="$(mktemp)"
  if jq --arg cmd "$SCAN_CMD" '
    .hooks.SessionStart = ([ (.hooks.SessionStart // [])[]
        | if has("hooks") then
            (.hooks = [ (.hooks // [])[] | select((.command // "") | test("session-start-scan.sh") | not) ])
            | select((.hooks | length) > 0)
          else . end ]
      + [ {hooks: [ {type: "command", command: $cmd, timeout: 30, statusMessage: "task-observer scan"} ]} ])' "$USER_SETTINGS" > "$tmp"; then
    mv "$tmp" "$USER_SETTINGS"; echo "  hook   -> $USER_SETTINGS (SessionStart task-observer scan)"
  else rm -f "$tmp"; echo "warning: could not merge the task-observer scan hook into $USER_SETTINGS — left unchanged; CLAUDE.md falls back to loading the skill." >&2; fi
else
  echo "warning: $USER_SETTINGS has an unexpected shape (hooks.SessionStart must be an array) — scan hook NOT installed; CLAUDE.md falls back to loading the skill." >&2
fi

echo
echo "Done. Harness agents: analyst, architect, developer (xN), tester (xN), task-observer."
echo "Kit: $KIT  — start a run in a project with: bash $KIT/harness/init-run.sh ORCS-001"
echo "Global skills: find-skills, caveman, task-observer, impeccable, superpowers, claude-mem; harness skill: orcs-harness."
