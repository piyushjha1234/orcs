#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
S="$H/tester-shards.sh"; M="$H/merge-test-reports.sh"; AP="$H/approve.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
R="$T/repo"; TD="$R/executions/ORCS-001"; IB=orcs/ORCS-001/integration
g() { git -C "$R" "$@" >/dev/null 2>&1; }
req() { # req <n> — approved requirement with BR-1..BR-n
  jq --argjson n "$1" '.requirements = [range(1; $n + 1) as $i | (.requirements[0] | .id = "BR-\($i)")]' "$FX/requirement/valid.json" > "$T/req.json"
}
setup() { # setup <n-brs> [max_testers] [min_brs_per_tester]
  rm -rf "$R"; mkdir -p "$R" && git -C "$R" init -q -b main && git -C "$R" config user.email t@t && git -C "$R" config user.name t
  echo app > "$R/app.txt"; g add -A; g commit -qm base; g branch "$IB"; echo "executions/" >> "$R/.git/info/exclude"
  mkdir -p "$TD"; req "$1"; bash "$AP" "$TD" requirement "$T/req.json" owner >/dev/null
  jq -n --argjson m "${2:-10}" --argjson b "${3:-3}" '{limits:{max_testers:$m, min_brs_per_tester:$b}, counts:{}}' > "$TD/budgets.json"
  echo '{"overall_status":"PASS"}' > "$TD/integration.json"
}
shards() { (cd "$R" && bash "$S" executions/ORCS-001 "$IB"); }
nshards() { jq '.shards | length' "$TD/tester-shards.json"; }
report() { # report <shard> <status> <BR:TC>... — a valid shard report
  local sh="$1" st="$2"; shift 2
  jq -n --arg st "$st" '{task_id:"ORCS-001", results:[], scenarios:[], traceability:{}, flaws:[], overall_status:$st}' > "$TD/test-report.$sh.json"
  for p in "$@"; do
    jq --arg b "${p%%:*}" --arg t "TC-${p##*:}" --arg st "$st" '.results += [{requirement_id:$b, status:$st, evidence:"\($t) run"}]
       | .scenarios += [{id:$t, requirement_id:$b, type:"positive", steps:"s", expected:"e"}] | .traceability[$b] += [$t]' \
      "$TD/test-report.$sh.json" > "$T/x" && mv "$T/x" "$TD/test-report.$sh.json"
  done
}
merge() { bash "$M" "$TD"; }

setup 2;  assert_pass "small project: shard runs"  shards
assert_pass "2 BRs → 1 tester"                    bash -c "[ \"\$(jq '.shards|length' '$TD/tester-shards.json')\" = 1 ]"
setup 9;  shards >/dev/null
assert_pass "9 BRs / 3 per tester → 3 testers"     bash -c "[ \"\$(jq '.shards|length' '$TD/tester-shards.json')\" = 3 ]"
assert_pass "shards disjoint and complete"         jq -e '[.shards[].brs[]] | (length == 9) and (unique | length == 9)' "$TD/tester-shards.json"
assert_pass "TC blocks do not overlap"             jq -e '[.shards[].tc_start] == [1, 1001, 2001]' "$TD/tester-shards.json"
assert_pass "port offsets differ"                  jq -e '[.shards[].port_offset] == [0, 10, 20]' "$TD/tester-shards.json"
assert_pass "each shard has its own worktree"      bash -c "for i in 1 2 3; do test -f '$R/.orcs-wt/TEST-'\$i/app.txt || exit 1; done"
assert_pass "dispatch line format"                 bash -c "cd '$R' && bash '$S' executions/ORCS-001 '$IB' | head -1 | grep -qE '^TEST-1 .*/\.orcs-wt/TEST-1 BR-1,BR-2,BR-3 tc_start=1 port_offset=0$'"
setup 40; shards >/dev/null
assert_pass "capped at max_testers 10"             bash -c "[ \"\$(jq '.shards|length' '$TD/tester-shards.json')\" = 10 ]"
setup 40 4; shards >/dev/null
assert_pass "owner override max_testers 4"         bash -c "[ \"\$(jq '.shards|length' '$TD/tester-shards.json')\" = 4 ]"
setup 3; echo '{"overall_status":"FAIL"}' > "$TD/integration.json"
assert_fail "no shards before integration PASS"    "integration has not passed" shards

# merge
setup 6 10 3; shards >/dev/null      # TEST-1: BR-1..3 (TC 1..), TEST-2: BR-4..6 (TC 1001..)
report TEST-1 PASS BR-1:1 BR-2:2 BR-3:3; report TEST-2 PASS BR-4:1001 BR-5:1002 BR-6:1003
assert_pass "valid shards merge"                   merge
assert_pass "merged report covers every BR"        bash "$H/validate-contract.sh" --approved "$TD/requirement.approved.json" test-report "$TD/test-report.json"
assert_pass "merged PASS"                          jq -e '.overall_status == "PASS" and (.scenarios | length == 6)' "$TD/test-report.json"
assert_pass "merged report is approvable"          bash "$AP" "$TD" test-report "$TD/test-report.json" owner
report TEST-2 FAIL BR-4:1001 BR-5:1002 BR-6:1003
assert_pass "a failing shard → merged FAIL"        bash -c "bash '$M' '$TD' >/dev/null && jq -e '.overall_status == \"FAIL\"' '$TD/test-report.json'"
rm "$TD/test-report.TEST-2.json"
assert_fail "missing shard refused"                "missing shard report" merge
report TEST-2 PASS BR-4:1001 BR-5:1002 BR-6:1003 BR-1:1004
assert_fail "BR outside shard refused"             "reports BR-1, which is not in its shard" merge
report TEST-2 PASS BR-4:1001 BR-5:1002 BR-6:5
assert_fail "TC outside id block refused"          "outside its id block" merge
report TEST-2 PASS BR-4:1001 BR-5:1002
assert_fail "uncovered BR refused"                 "BR-6 not tested" merge
assert_pass "refused merge leaves last good report" jq -e '.overall_status == "FAIL"' "$TD/test-report.json"
finish
