#!/usr/bin/env bash
# precheck.sh <task-dir> <DEV-n> <dev-branch> <integration-branch> <worktree>   (run from repo root)
# Cheap deterministic checks on a developer's branch BEFORE the orchestrator pays for a
# scope-auditor agent: approved-architecture hash → worktree committed at the branch head →
# file-level scope gate → lint → unit tests (in the developer's own worktree).
# Pass: prints "OK: …" — dispatch the scope auditor, then run integration.sh (which re-runs
# everything on the merged result; this is a filter, not a substitute).
# Fail: prints "REDISPATCH <DEV-n>: <reason>", writes <task-dir>/<DEV-n>.precheck.log and the
# excerpt <task-dir>/<DEV-n>.failure.txt, traces the rework, exits 1. Count the fix cycle.
# Commands come from <task-dir>/harness.conf (LINT_CMD, UNIT_TEST_CMD; empty/none = skip).
HD="$(cd "$(dirname "$0")" && pwd)"
source "$HD/lib/common.sh"
[ $# -eq 5 ] || die "usage: precheck.sh <task-dir> <DEV-n> <dev-branch> <integration-branch> <worktree>"
td="$1"; dev="$2"; br="$3"; ib="$4"; wt="$5"
require_cmd git
msg=$(verify_approved "$td" architecture) || die "$msg"
arch="$td/architecture.approved.json"; log="$td/$dev.precheck.log"; tracef="$td/execution-trace.json"
[ -f "$td/harness.conf" ] || die "missing $td/harness.conf (LINT_CMD, UNIT_TEST_CMD, INTEGRATION_TEST_CMD)"
LINT_CMD=""; UNIT_TEST_CMD=""
# shellcheck disable=SC1091
source "$td/harness.conf"
git rev-parse --verify -q "$br^{commit}" >/dev/null || die "branch not found: $br"
git show-ref --verify -q "refs/heads/$ib" || die "integration branch must be a local branch: $ib"
[ -d "$wt" ] || die "worktree not found: $wt"

mt=$(mktemp)
trap 'rm -f "$mt" "$mt.changed" "$mt.err"' EXIT
jq --arg d "$dev" '[.microtasks[] | select(.task_id == $d)] | if length == 1 then .[0] else empty end' "$arch" > "$mt"
[ -s "$mt" ] || die "$dev not found exactly once in $arch"
: > "$log"

reject() { # reject <reason> [scope]
  if [ "${2:-}" = scope ]; then trace_event "$tracef" scope_violation "$dev: precheck $1" precheck
  else trace_event "$tracef" rework_cycle "$dev: precheck $1" precheck; fi
  write_failure_excerpt "$log" "$td/$dev.failure.txt" "precheck: $1"
  echo "REDISPATCH $dev: precheck $1 (excerpt: $td/$dev.failure.txt; full log: $log)" >&2; exit 1
}

[ "$(git -C "$wt" rev-parse HEAD 2>/dev/null)" = "$(git rev-parse "$br")" ] \
  || reject "worktree $wt is not at the head of $br — the developer must commit on its branch"
dirty=$(git -C "$wt" status --porcelain --untracked-files=no)
[ -z "$dirty" ] || { printf '%s\n' "$dirty" >> "$log"; reject "uncommitted changes in $wt — the developer must commit them"; }

git -c core.quotePath=false diff --no-renames --name-only "$ib...$br" > "$mt.changed" 2>>"$log" \
  || die "git diff $ib...$br failed (no merge base?) — see $log"
echo "== scope gate" >> "$log"
bash "$HD/scope-gate.sh" "$mt" "$mt.changed" >>"$log" 2>"$mt.err" \
  || { cat "$mt.err" >> "$log"; reject "scope gate — $(tr '\n' ' ' < "$mt.err")" scope; }

runstep() { # runstep <label> <cmd>
  { [ -z "$2" ] || [ "$2" = "none" ]; } && return 0
  echo "== $1: $2" >> "$log"
  (cd "$wt" && bash -c "$2") >>"$log" 2>&1 || reject "$1 failed: $2"
}
runstep lint "$LINT_CMD"
runstep "unit tests" "$UNIT_TEST_CMD"
rm -f "$td/$dev.failure.txt"
echo "OK: $dev pre-check passed (scope gate, lint, unit) — dispatch the scope auditor"
