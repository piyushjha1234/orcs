#!/usr/bin/env bash
# integration.sh <task-dir> <DEV-n> <dev-branch> <integration-branch>   (run from repo root)
# Integration Manager. Deterministic detection only — it never edits code.
#   scope-gate → scope-audit → merge (temp worktree) → lint → unit → integration tests
# Only a fully passing branch moves the integration branch. Any failure prints
# "REDISPATCH <DEV-n>: <reason>" and exits 1 so the orchestrator re-dispatches the developer.
# Commands come from <task-dir>/harness.conf: LINT_CMD, UNIT_TEST_CMD (optional),
# INTEGRATION_TEST_CMD (required; set to "none" to skip explicitly).
source "$(dirname "$0")/lib/common.sh"
HD="$(cd "$(dirname "$0")" && pwd)"
[ $# -eq 4 ] || die "usage: integration.sh <task-dir> <DEV-n> <dev-branch> <integration-branch>"
td="$1"; dev="$2"; br="$3"; ib="$4"
require_cmd git
arch="$td/architecture.approved.json"; req="$td/requirement.approved.json"; audit="$td/$dev.audit.json"
require_json_file "$arch"; require_json_file "$req"
[ -f "$td/harness.conf" ] || die "missing $td/harness.conf (LINT_CMD, UNIT_TEST_CMD, INTEGRATION_TEST_CMD)"
LINT_CMD=""; UNIT_TEST_CMD=""; INTEGRATION_TEST_CMD=""
# shellcheck disable=SC1091
source "$td/harness.conf"
[ -n "$INTEGRATION_TEST_CMD" ] || die "INTEGRATION_TEST_CMD not set in $td/harness.conf (use \"none\" to skip explicitly)"

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
reject() { record FAIL "$1"; echo "REDISPATCH $dev: $1" >&2; exit 1; }

mt=$(mktemp); trap 'rm -f "$mt"' EXIT
jq --arg d "$dev" '.microtasks[] | select(.task_id == $d)' "$arch" > "$mt"
[ -s "$mt" ] || die "$dev not found in $arch"
git rev-parse --verify -q "$br" >/dev/null || die "branch not found: $br"
git rev-parse --verify -q "$ib" >/dev/null || die "integration branch not found: $ib"

changed=$(mktemp); git diff --name-only "$ib...$br" > "$changed"
bash "$HD/scope-gate.sh" "$mt" "$changed" >/dev/null 2>"$changed.err" || { r=$(tr '\n' ' ' < "$changed.err"); rm -f "$changed" "$changed.err"; reject "scope gate — $r"; }
rm -f "$changed" "$changed.err"
[ -f "$audit" ] || die "missing scope-auditor verdict $audit — run the auditor (scope-auditor/PROMPT.md) first"
aerr=$(mktemp)
bash "$HD/scope-audit.sh" "$audit" "$req" >/dev/null 2>"$aerr" || { r=$(tr '\n' ' ' < "$aerr"); rm -f "$aerr"; reject "scope audit — $r"; }
rm -f "$aerr"

wt=$(mktemp -d); old=$(git rev-parse "$ib")
cleanup() { git worktree remove --force "$wt" >/dev/null 2>&1; rm -rf "$wt" "$mt"; }
trap cleanup EXIT
git worktree add -q --detach "$wt" "$ib" >/dev/null 2>&1 || die "could not create temp worktree for $ib"
git -C "$wt" merge -q --no-ff --no-edit "$br" >/dev/null 2>&1 || { git -C "$wt" merge --abort >/dev/null 2>&1; reject "merge conflict with $ib"; }
runstep() { # runstep <label> <cmd>
  [ -z "$2" ] || [ "$2" = "none" ] && return 0
  (cd "$wt" && bash -c "$2") >/dev/null 2>&1 || reject "$1 failed: $2"
}
runstep lint "$LINT_CMD"
runstep "unit tests" "$UNIT_TEST_CMD"
runstep "integration tests" "$INTEGRATION_TEST_CMD"
git update-ref "refs/heads/$ib" "$(git -C "$wt" rev-parse HEAD)" "$old" || die "integration branch moved during run; re-run"
record PASS "merged"
grep -qx "$dev" "$td/done.txt" 2>/dev/null || echo "$dev" >> "$td/done.txt"
echo "OK: $dev integrated into $ib — overall $(jq -r .overall_status "$ijson")"
