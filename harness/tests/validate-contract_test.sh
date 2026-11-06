#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
V="$H/validate-contract.sh"

for kind in requirement architecture microtask implementation test-report execution-trace; do
  assert_pass "valid $kind" bash "$V" "$kind" "$FX/$kind/valid.json"
done
assert_fail "duplicate BR-ID"        "duplicate BR-ID"  bash "$V" requirement "$FX/requirement/invalid-duplicate-brid.json"
assert_fail "missing out_of_scope"   "out_of_scope"     bash "$V" requirement "$FX/requirement/invalid-missing-field.json"
assert_fail "bad complexity enum"    "complexity"       bash "$V" requirement "$FX/requirement/invalid-enum.json"
assert_fail "empty acceptance"       "acceptance"       bash "$V" requirement "$FX/requirement/invalid-no-acceptance.json"
assert_fail "missing allowed_files"  "allowed_files"    bash "$V" microtask "$FX/microtask/invalid-missing-allowed-files.json"
assert_fail "bad BR-ID format"       "BR-ID"            bash "$V" microtask "$FX/microtask/invalid-bad-brid.json"
assert_fail "unjustified dependency" "justification"    bash "$V" architecture "$FX/architecture/invalid-unjustified-dep.json"
assert_fail "no microtasks"          "microtasks"       bash "$V" architecture "$FX/architecture/invalid-no-microtasks.json"
assert_fail "missing blocker"        "blocker"          bash "$V" implementation "$FX/implementation/invalid-missing-blocker.json"
assert_fail "untraced scenario"      "traceability"     bash "$V" test-report "$FX/test-report/invalid-untraced-scenario.json"
assert_fail "bad overall_status"     "overall_status"   bash "$V" test-report "$FX/test-report/invalid-enum.json"
assert_fail "bad trace field"        "field"            bash "$V" execution-trace "$FX/execution-trace/invalid-enum.json"
assert_fail "unknown kind"           "unknown kind"     bash "$V" bogus "$FX/requirement/valid.json"
assert_fail "malformed json"         "not valid JSON"   bash "$V" requirement /dev/null
AP="$FX/requirement/valid.json"   # approves BR-1, BR-2
assert_fail "duplicate microtask id"         "duplicate micro-task id: DEV-1" bash "$V" architecture "$FX/architecture/invalid-duplicate-microtask.json"
assert_fail "PASS with a FAIL result"        "overall_status PASS" bash "$V" test-report "$FX/test-report/invalid-pass-with-fail.json"
assert_pass "architecture covers approved"   bash "$V" --approved "$AP" architecture "$FX/architecture/valid.json"
assert_fail "architecture maps unapproved BR" "BR-77" bash "$V" --approved "$AP" architecture "$FX/architecture/invalid-unapproved-br.json"
assert_fail "architecture leaves BR uncovered" "BR-2 not covered" bash "$V" --approved "$AP" architecture "$FX/architecture/invalid-uncovered-br.json"
assert_pass "test-report covers approved"    bash "$V" --approved "$AP" test-report "$FX/test-report/valid.json"
assert_fail "test-report invents a BR"       "BR-99" bash "$V" --approved "$AP" test-report "$FX/test-report/invalid-invented-br.json"
assert_fail "test-report leaves BR untested" "BR-1 not tested" bash "$V" --approved "$AP" test-report "$FX/test-report/invalid-invented-br.json"
assert_fail "--approved must be readable"    "cannot read" bash "$V" --approved /nope architecture "$FX/architecture/valid.json"
finish
