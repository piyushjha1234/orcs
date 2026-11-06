#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
I="$H/integration.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
R="$T/repo"; TD="$R/executions/ORCS-001"
g() { git -C "$R" "$@" >/dev/null 2>&1; }
setup() { # setup <arch-microtask-count>
  rm -rf "$R"; mkdir -p "$R/src" && git -C "$R" init -q -b main && git -C "$R" config user.email t@t && git -C "$R" config user.name t
  echo "def segment(): pass" > "$R/src/segment.py"; echo "x=1" > "$R/src/billing.py"; g add -A; g commit -qm base
  g branch orcs/ORCS-001/integration; echo "executions/" >> "$R/.git/info/exclude"
  mkdir -p "$TD"; cp "$FX/requirement/valid.json" "$TD/requirement.approved.json"
  if [ "$1" = 2 ]; then jq '.microtasks += [(.microtasks[0] | .task_id="DEV-2" | .allowed_files=["src/billing.py"] | .expected_outputs=[])]' "$FX/architecture/valid.json" > "$TD/architecture.approved.json"
  else cp "$FX/architecture/valid.json" "$TD/architecture.approved.json"; fi
  echo '{"task_id":"DEV-1","changes":[{"ref":"src/segment.py:segment()","br_id":"BR-1"}]}' > "$TD/DEV-1.audit.json"
  printf 'UNIT_TEST_CMD="test -f src/segment.py"\nINTEGRATION_TEST_CMD="grep -q inactive src/segment.py"\n' > "$TD/harness.conf"
  : > "$TD/done.txt"
}
dev_branch() { # dev_branch <file> <content>
  g checkout -q -b orcs/ORCS-001/DEV-1 orcs/ORCS-001/integration; echo "$2" > "$R/$1"; g add -A; g commit -qm dev; g checkout -q main
}
run() { (cd "$R" && bash "$I" executions/ORCS-001 DEV-1 orcs/ORCS-001/DEV-1 orcs/ORCS-001/integration); }
intg_has() { git -C "$R" show "orcs/ORCS-001/integration:$1" 2>/dev/null | grep -q "$2"; }

setup 1; dev_branch src/segment.py "def segment(): return 'inactive'"
assert_pass "clean branch integrates"            run
assert_pass "integration branch has the change"  intg_has src/segment.py inactive
assert_pass "status PASS when all merged"        jq -e '.overall_status=="PASS"' "$TD/integration.json"
assert_pass "DEV-1 recorded done"                grep -qx DEV-1 "$TD/done.txt"

setup 1; dev_branch src/billing.py "x=2"
assert_fail "out-of-scope edit rejected"         "REDISPATCH DEV-1" run
assert_pass "integration branch untouched"       intg_has src/billing.py "x=1"
assert_pass "status FAIL after rejection"        jq -e '.overall_status=="FAIL"' "$TD/integration.json"

setup 1; dev_branch src/segment.py "def segment(): return 'active'"
assert_fail "failing integration test rejected"  "REDISPATCH DEV-1" run
assert_pass "failed merge not applied"           bash -c "! git -C '$R' show orcs/ORCS-001/integration:src/segment.py | grep -q active"

setup 1; dev_branch src/segment.py "def segment(): return 'inactive'"; rm "$TD/DEV-1.audit.json"
assert_fail "missing auditor verdict refused"    "audit" run

setup 1; dev_branch src/segment.py "def segment(): return 'inactive'"; echo '{"task_id":"DEV-1","changes":[{"ref":"src/segment.py:export()","br_id":null}]}' > "$TD/DEV-1.audit.json"
assert_fail "unmapped behaviour rejected"        "REDISPATCH DEV-1" run

setup 1; dev_branch src/segment.py "def segment(): return 'inactive'"; sed -i '' '/INTEGRATION_TEST_CMD/d' "$TD/harness.conf"
assert_fail "integration cmd required"           "INTEGRATION_TEST_CMD" run

setup 2; dev_branch src/segment.py "def segment(): return 'inactive'"
assert_pass "first of two integrates"            run
assert_pass "status PENDING until all merged"    jq -e '.overall_status=="PENDING"' "$TD/integration.json"
finish
