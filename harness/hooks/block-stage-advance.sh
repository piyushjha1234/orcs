#!/usr/bin/env bash
# Claude Code PreToolUse hook (matcher: Agent|Task).
# Hard-blocks dispatch of an Orcs stage agent until its prerequisite gate has passed.
# Exit 0 = allow; exit 2 = block (stderr is shown to the orchestrating session).
HDIR="$(cd "$(dirname "$0")/.." && pwd)"
command -v jq >/dev/null 2>&1 || { echo "orcs-harness hook: jq not found — cannot verify gates" >&2; exit 2; }
source "$HDIR/lib/common.sh" 2>/dev/null || { echo "orcs-harness hook: kit or jq missing — cannot verify gates" >&2; exit 2; }
input=$(cat)

find_run() { # find_run <start-dir> — nearest ancestor holding executions/ACTIVE
  local d="$1"
  while [ -n "$d" ]; do
    [ -f "$d/executions/ACTIVE" ] && { echo "$d"; return 0; }
    [ "$d" = "/" ] && return 1
    d=$(dirname "$d")
  done
  return 1
}

if ! jq -e 'type=="object"' >/dev/null 2>&1 <<<"$input"; then
  proj="${CLAUDE_PROJECT_DIR:-}"; [ -n "$proj" ] && [ -f "$proj/executions/ACTIVE" ] || proj=$(find_run "$PWD") || exit 0
  echo "ORCS GATE BLOCKED: hook input unreadable while run $(cat "$proj/executions/ACTIVE") is active" >&2; exit 2
fi
tool=$(jq -r '.tool_name // ""' <<<"$input")
case "$tool" in Agent|Task) ;; *) exit 0 ;; esac
raw=$(jq -r '.tool_input.subagent_type // ""' <<<"$input")
agent=$(printf '%s' "${raw##*:}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -f "$CLAUDE_PROJECT_DIR/executions/ACTIVE" ]; then proj="$CLAUDE_PROJECT_DIR"
else proj=$(find_run "$(jq -r '.cwd // empty' <<<"$input")") || proj=$(find_run "$PWD") || exit 0; fi
task=$(tr -d '[:space:]' < "$proj/executions/ACTIVE")
dir="$proj/executions/$task"

block() { echo "ORCS GATE BLOCKED dispatch of '$raw' for $task: $*" >&2; exit 2; }
need_approved() { # need_approved <kind>
  local msg
  msg=$(verify_approved "$dir" "$1") || block "$msg"
  if [ "$1" = requirement ]; then
    bash "$HDIR/validate-contract.sh" requirement "$dir/requirement.approved.json" >/dev/null 2>&1 || block "$dir/requirement.approved.json fails validation"
  else
    bash "$HDIR/validate-contract.sh" --approved "$dir/requirement.approved.json" "$1" "$dir/$1.approved.json" >/dev/null 2>&1 || block "$dir/$1.approved.json fails validation"
  fi
}

case "$agent" in
  architect)      need_approved requirement ;;
  developer)      need_approved requirement; need_approved architecture ;;
  tester)         need_approved requirement; need_approved architecture
                  [ "$(jq -r '.overall_status // ""' "$dir/integration.json" 2>/dev/null)" = "PASS" ] \
                    || block "integration has not passed (need $dir/integration.json overall_status PASS from harness/integration.sh)." ;;
  task-observer)  need_approved requirement; need_approved test-report ;;
  *) exit 0 ;;
esac
exit 0
