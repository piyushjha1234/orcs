#!/usr/bin/env bash
# Claude Code PreToolUse hook (matcher: Agent|Task).
# Hard-blocks dispatch of an Orcs stage agent until its prerequisite gate has passed.
# Exit 0 = allow; exit 2 = block (stderr is shown to the orchestrating session).
HDIR="$(cd "$(dirname "$0")/.." && pwd)"
command -v jq >/dev/null 2>&1 || { echo "orcs-harness hook: jq not found — cannot verify gates" >&2; exit 2; }
input=$(cat)
tool=$(jq -r '.tool_name // ""' <<<"$input")
case "$tool" in Agent|Task) ;; *) exit 0 ;; esac
agent=$(jq -r '.tool_input.subagent_type // ""' <<<"$input")
proj="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // "."' <<<"$input")}"
active_file="$proj/executions/ACTIVE"
[ -f "$active_file" ] || exit 0                       # not inside an Orcs run
task=$(tr -d '[:space:]' < "$active_file")
dir="$proj/executions/$task"

block() { echo "ORCS GATE BLOCKED dispatch of '$agent' for $task: $*" >&2; exit 2; }
need_approved() { # need_approved <kind>
  local f="$dir/$1.approved.json"
  [ -f "$f" ] || block "$1 contract not approved by owner (missing $f). Run the contract-review gate, then harness/approve.sh."
  bash "$HDIR/validate-contract.sh" "$1" "$f" >/dev/null 2>&1 || block "$f fails validation (edited after approval?). Re-run review + approve."
}

case "$agent" in
  architect)      need_approved requirement ;;
  developer)      need_approved requirement; need_approved architecture ;;
  tester)         need_approved requirement; need_approved architecture
                  [ "$(jq -r '.overall_status // ""' "$dir/integration.json" 2>/dev/null)" = "PASS" ] \
                    || block "integration has not passed (need $dir/integration.json overall_status PASS from harness/integration.sh)." ;;
  task-observer)  need_approved test-report ;;
  *) exit 0 ;;
esac
exit 0
