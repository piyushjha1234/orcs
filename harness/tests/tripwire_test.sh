#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
W="$H/complexity-tripwire.sh"; LOW="$FX/microtask/valid.json"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
jq '.complexity="medium"' "$LOW" > "$T/med.json"
assert_pass "low, 2 files, no deps stays fast"   bash "$W" "$LOW" 2 0
assert_pass "low, at threshold 3 stays fast"     bash "$W" "$LOW" 3 0
assert_fail "low, 4 files escalates"             "ESCALATE" bash "$W" "$LOW" 4 0
assert_fail "low, new dependency escalates"      "dependency" bash "$W" "$LOW" 1 1
assert_fail "low, iterations over budget"        "iterations" bash "$W" "$LOW" 1 0 4
assert_pass "env override raises threshold"      env ORCS_FASTPATH_MAX_FILES=10 bash "$W" "$LOW" 6 0
assert_pass "non-low task is not tripwired"      bash "$W" "$T/med.json" 50 3
assert_fail "non-numeric count refused"          "integer" bash "$W" "$LOW" many 0
jq '.budget.max_iterations=2.5' "$LOW" > "$T/frac.json"
assert_fail "fractional budget refused"       "integer" bash "$W" "$T/frac.json" 1 0
assert_fail "bad env threshold refused"       "ORCS_FASTPATH_MAX_FILES" env ORCS_FASTPATH_MAX_FILES=3x bash "$W" "$LOW" 1 0
finish
