#!/usr/bin/env bash
# integration.sh <task-dir> <DEV-n> <dev-branch> <integration-branch>   (run from repo root)
# Integration Manager. Deterministic detection only — it never edits code.
#   approved-contract hashes → scope gate (no-renames diff) → scope audit (bound to the
#   branch head) → merge in a temp worktree → lint → unit → integration tests →
#   fast-path trip-wire (complexity low) → move the integration branch.
# Only a fully passing branch moves the integration branch. A fixable failure prints
# "REDISPATCH <DEV-n>: <reason>"; a mislabelled fast-path task prints "ESCALATE <DEV-n>".
# Both exit 1. Step output is kept in <task-dir>/<DEV-n>.integration.log as evidence.
# Commands come from <task-dir>/harness.conf: LINT_CMD, UNIT_TEST_CMD (optional),
# INTEGRATION_TEST_CMD (required; "none" to skip explicitly), DEPENDENCY_FILES (optional,
# space-separated manifests, e.g. "package.json requirements.txt").
# Run integrations one at a time per task (integration.json is not locked).
HD="$(cd "$(dirname "$0")" && pwd)"
source "$HD/lib/common.sh"
[ $# -eq 4 ] || die "usage: integration.sh <task-dir> <DEV-n> <dev-branch> <integration-branch>"
td="$1"; dev="$2"; br="$3"; ib="$4"
require_cmd git
for k in requirement architecture; do msg=$(verify_approved "$td" "$k") || die "$msg"; done
arch="$td/architecture.approved.json"; req="$td/requirement.approved.json"; audit="$td/$dev.audit.json"
log="$td/$dev.integration.log"
[ -f "$td/harness.conf" ] || die "missing $td/harness.conf (LINT_CMD, UNIT_TEST_CMD, INTEGRATION_TEST_CMD)"
LINT_CMD=""; UNIT_TEST_CMD=""; INTEGRATION_TEST_CMD=""; DEPENDENCY_FILES=""
# shellcheck disable=SC1091
source "$td/harness.conf"
[ -n "$INTEGRATION_TEST_CMD" ] || die "INTEGRATION_TEST_CMD not set in $td/harness.conf (use \"none\" to skip explicitly)"

git show-ref --verify -q "refs/heads/$ib" || die "integration branch must be a local branch: $ib"
git rev-parse --verify -q "$br^{commit}" >/dev/null || die "branch not found: $br"
git worktree list --porcelain | grep -qx "branch refs/heads/$ib" \
  && die "integration branch $ib is checked out in a worktree — check out another branch there (moving its ref would corrupt that checkout)"

ijson="$td/integration.json"
[ -f "$ijson" ] || jq -n --arg t "$(jq -r .task_id "$arch")" '{task_id:$t, merged:[], runs:[], overall_status:"PENDING"}' > "$ijson"
record() { # record <status> <reason>
  local tmp; tmp=$(mktemp)
  jq --arg d "$dev" --arg s "$1" --arg r "$2" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --slurpfile a "$arch" '
    .runs += [{ts:$ts, microtask:$d, status:$s, reason:$r}] |
    (if $s == "PASS" then .merged = ((.merged + [$d]) | unique) else . end) |
    .overall_status = (if $s != "PASS" then "FAIL"
                       elif ([$a[0].microtasks[].task_id] - .merged | length) == 0 then "PASS"
                       else "PENDING" end)' "$ijson" > "$tmp" && mv "$tmp" "$ijson"
}
reject()   { record FAIL "$1"; echo "REDISPATCH $dev: $1 (evidence: $log)" >&2; exit 1; }
escalate() { record FAIL "escalate: $1"; echo "ESCALATE $dev: $1 — re-run the architect for a full decomposition" >&2; exit 1; }

mt=$(mktemp); wt=""
cleanup() { [ -n "$wt" ] && { git worktree remove --force "$wt" >/dev/null 2>&1; rm -rf "$wt"; }; rm -f "$mt" "$mt.changed" "$mt.err"; }
trap cleanup EXIT
jq --arg d "$dev" '[.microtasks[] | select(.task_id == $d)] | if length == 1 then .[0] else empty end' "$arch" > "$mt"
[ -s "$mt" ] || die "$dev not found exactly once in $arch"
: > "$log"

git -c core.quotePath=false diff --no-renames --name-only "$ib...$br" > "$mt.changed" 2>>"$log" \
  || die "git diff $ib...$br failed (no merge base?) — see $log"
bash "$HD/scope-gate.sh" "$mt" "$mt.changed" >>"$log" 2>"$mt.err" || { cat "$mt.err" >> "$log"; reject "scope gate — $(tr '\n' ' ' < "$mt.err")"; }
[ -f "$audit" ] || die "missing scope-auditor verdict $audit — run the auditor (scope-auditor/PROMPT.md) first"
head=$(git rev-parse "$br")
[ "$(jq -r '.commit // ""' "$audit")" = "$head" ] || die "stale scope-auditor verdict $audit (commit $(jq -r '.commit // "none"' "$audit"), branch head $head) — re-run the auditor on the current branch head"
bash "$HD/scope-audit.sh" "$audit" "$req" >>"$log" 2>"$mt.err" || { cat "$mt.err" >> "$log"; reject "scope audit — $(tr '\n' ' ' < "$mt.err")"; }

wt=$(mktemp -d); rmdir "$wt"; old=$(git rev-parse "refs/heads/$ib")
git worktree add -q --detach "$wt" "$ib" >>"$log" 2>&1 || die "could not create temp worktree for $ib"
git -C "$wt" merge -q --no-ff --no-edit "$br" >>"$log" 2>&1 || { git -C "$wt" merge --abort >/dev/null 2>&1; reject "merge conflict with $ib"; }
runstep() { # runstep <label> <cmd>
  { [ -z "$2" ] || [ "$2" = "none" ]; } && return 0
  echo "== $1: $2" >> "$log"
  (cd "$wt" && bash -c "$2") >>"$log" 2>&1 || reject "$1 failed: $2"
}
runstep lint "$LINT_CMD"
runstep "unit tests" "$UNIT_TEST_CMD"
runstep "integration tests" "$INTEGRATION_TEST_CMD"

if [ "$(jq -r .complexity "$mt")" = low ]; then
  nfiles=$(grep -c . "$mt.changed" || true); ndeps=0
  for m in $DEPENDENCY_FILES; do grep -qxF -- "$m" "$mt.changed" && ndeps=$((ndeps+1)); done
  iters=0; [ -f "$td/budgets.json" ] && iters=$(jq -r --arg c "fix_cycles_$dev" '.counts[$c] // 0' "$td/budgets.json")
  bash "$HD/complexity-tripwire.sh" "$mt" "$nfiles" "$ndeps" "$iters" >>"$log" 2>"$mt.err" \
    || { cat "$mt.err" >> "$log"; escalate "$(tr '\n' ' ' < "$mt.err")"; }
fi

git update-ref "refs/heads/$ib" "$(git -C "$wt" rev-parse HEAD)" "$old" || die "integration branch moved during run; re-run"
record PASS "merged"
grep -qx "$dev" "$td/done.txt" 2>/dev/null || echo "$dev" >> "$td/done.txt"
if [ -f "$td/inflight.txt" ]; then grep -vx "$dev" "$td/inflight.txt" > "$mt.err" || true; cat "$mt.err" > "$td/inflight.txt"; fi
echo "OK: $dev integrated into $ib — overall $(jq -r .overall_status "$ijson")"
