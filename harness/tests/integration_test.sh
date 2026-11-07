#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
I="$H/integration.sh"; AP="$H/approve.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
R="$T/repo"; TD="$R/executions/ORCS-001"; B=orcs/ORCS-001/DEV-1; IB=orcs/ORCS-001/integration
g() { git -C "$R" "$@" >/dev/null 2>&1; }
setup() { # setup [2]
  rm -rf "$R"; mkdir -p "$R/src" && git -C "$R" init -q -b main && git -C "$R" config user.email t@t && git -C "$R" config user.name t
  echo "def segment(): pass" > "$R/src/segment.py"; echo "x=1" > "$R/src/billing.py"; g add -A; g commit -qm base
  g branch "$IB"; echo "executions/" >> "$R/.git/info/exclude"
  mkdir -p "$TD"; bash "$AP" "$TD" requirement "$FX/requirement/valid.json" owner >/dev/null
  if [ "${1:-1}" = 2 ]; then jq '.microtasks += [(.microtasks[0] | .task_id="DEV-2" | .allowed_files=["src/billing.py"] | .expected_outputs=[])]' "$FX/architecture/valid.json" > "$T/arch.json"
  else cp "$FX/architecture/valid.json" "$T/arch.json"; fi
  bash "$AP" "$TD" architecture "$T/arch.json" owner >/dev/null || echo "SETUP: architecture approval failed"
  printf 'UNIT_TEST_CMD="test -f src/segment.py"\nINTEGRATION_TEST_CMD="grep -q inactive src/segment.py"\n' > "$TD/harness.conf"
  : > "$TD/done.txt"; echo DEV-1 > "$TD/inflight.txt"
}
dev() { # dev <file> <content> — commit one change on the DEV-1 branch
  git -C "$R" rev-parse -q --verify "$B" >/dev/null || g branch "$B" "$IB"
  g checkout -q "$B"; mkdir -p "$(dirname "$R/$1")"; echo "$2" > "$R/$1"; g add -A; g commit -qm dev; g checkout -q main
}
audit() { # audit [br_id] — verdict bound to the branch head
  jq -n --arg c "$(git -C "$R" rev-parse "$B")" --arg b "${1:-BR-1}" '{task_id:"DEV-1", commit:$c, changes:[{ref:"src/segment.py:segment()", br_id:(if $b=="null" then null else $b end)}]}' > "$TD/DEV-1.audit.json"
}
run() { (cd "$R" && bash "$I" executions/ORCS-001 DEV-1 "$B" "$IB"); }
intg_has() { git -C "$R" show "$IB:$1" 2>/dev/null | grep -q "$2"; }

setup; dev src/segment.py "def segment(): return 'inactive'"; audit
assert_pass "clean branch integrates"            run
assert_pass "integration branch has the change"  intg_has src/segment.py inactive
assert_pass "status PASS when all merged"        jq -e '.overall_status=="PASS"' "$TD/integration.json"
assert_pass "DEV-1 recorded done"                grep -qx DEV-1 "$TD/done.txt"
assert_pass "DEV-1 no longer in flight"          bash -c "! grep -qx DEV-1 '$TD/inflight.txt'"

setup; dev src/billing.py "x=2"; audit
assert_fail "out-of-scope edit rejected"         "REDISPATCH DEV-1" run
assert_pass "integration branch untouched"       intg_has src/billing.py "x=1"
assert_pass "status FAIL after rejection"        jq -e '.overall_status=="FAIL"' "$TD/integration.json"

setup; g checkout -q -b "$B" "$IB"; mkdir -p "$R/tests"; g mv src/billing.py tests/test_segment.py; g commit -qm "rename"; g checkout -q main; audit
assert_fail "rename out of scope rejected"       "src/billing.py" run
assert_pass "renamed-away file still on integration" intg_has src/billing.py "x=1"

setup; dev src/segment.py "def segment(): return 'active'"; audit
assert_fail "failing integration test rejected"  "REDISPATCH DEV-1" run
assert_pass "failed merge not applied"           bash -c "! git -C '$R' show $IB:src/segment.py | grep -q active"
assert_pass "evidence log written"               test -s "$TD/DEV-1.integration.log"
assert_fail "reject cites the evidence log"      "DEV-1.integration.log" run
assert_pass "failure excerpt written"            grep -q "FAILED: integration tests failed" "$TD/DEV-1.failure.txt"
assert_pass "excerpt starts at the failing step" bash -c "grep -q '^== integration tests' '$TD/DEV-1.failure.txt' && ! grep -q '^== unit tests' '$TD/DEV-1.failure.txt'"
assert_fail "reject cites the excerpt"           "DEV-1.failure.txt" run
dev src/segment.py "def segment(): return 'inactive'"; audit
assert_pass "fixed branch integrates"            run
assert_pass "excerpt removed after PASS"         test ! -e "$TD/DEV-1.failure.txt"

setup; dev src/segment.py "def segment(): return 'inactive'"; rm -f "$TD/DEV-1.audit.json"
assert_fail "missing auditor verdict refused"    "audit" run

setup; dev src/segment.py "def segment(): return 'inactive'"; audit null
assert_fail "unmapped behaviour rejected"        "REDISPATCH DEV-1" run

setup; dev src/segment.py "def segment(): return 'inactive'"; audit; dev src/segment.py "def segment(): return 'inactive' # extra"
assert_fail "stale verdict (older commit) refused" "stale" run

setup; dev src/segment.py "def segment(): return 'inactive'"; audit; jq '.microtasks[0].allowed_files += ["src/billing.py"]' "$TD/architecture.approved.json" > "$T/x" && mv "$T/x" "$TD/architecture.approved.json"
assert_fail "approved contract edited after approval" "changed after" run

setup; dev src/segment.py "def segment(): return 'inactive'"; audit; sed -i.bak '/INTEGRATION_TEST_CMD/d' "$TD/harness.conf"
assert_fail "integration cmd required"           "INTEGRATION_TEST_CMD" run

setup; dev src/segment.py "def segment(): return 'inactive'"; audit; g checkout -q "$IB"
assert_fail "checked-out integration branch refused" "checked out" run
g checkout -q main

setup; dev src/segment.py "def segment(): return 'inactive'"; audit; g tag v-int "$IB"
assert_fail "non-branch integration ref refused" "local branch" bash -c "cd '$R' && bash '$I' executions/ORCS-001 DEV-1 '$B' v-int"

setup; g checkout -q --orphan "$B"; g rm -rqf .; mkdir -p "$R/src"; echo "def segment(): return 'inactive'" > "$R/src/segment.py"; g add src/segment.py; g commit -qm orphan; g checkout -q -f main; audit
assert_fail "diff failure is not an empty scope" "diff" run

setup; dev src/segment.py "def segment(): return 'inactive'"; dev tests/test_segment.py "ok"; audit
assert_fail "low task over file limit escalates" "ESCALATE DEV-1" env ORCS_FASTPATH_MAX_FILES=1 bash -c "cd '$R' && bash '$I' executions/ORCS-001 DEV-1 '$B' '$IB'"
assert_pass "escalation leaves integration untouched" bash -c "! git -C '$R' show $IB:src/segment.py | grep -q inactive"
echo 'DEPENDENCY_FILES="tests/test_segment.py"' >> "$TD/harness.conf"
assert_fail "low task adding a dependency escalates" "dependency" run

setup 2; dev src/segment.py "def segment(): return 'inactive'"; audit
assert_pass "first of two integrates"            run
assert_pass "status PENDING until all merged"    jq -e '.overall_status=="PENDING"' "$TD/integration.json"
finish
