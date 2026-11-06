#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
B="$H/budgets.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
jq -n '{limits:{analyst_iterations:2, fix_cycles:3}, counts:{}}' > "$T/b.json"
assert_pass "1st analyst iteration"        bash "$B" "$T/b.json" analyst_iterations
assert_pass "2nd analyst iteration"        bash "$B" "$T/b.json" analyst_iterations
assert_fail "3rd breaches limit 2"         "BUDGET EXCEEDED: analyst_iterations" bash "$B" "$T/b.json" analyst_iterations
assert_pass "count persisted"              jq -e '.counts.analyst_iterations==3' "$T/b.json"
assert_pass "per-task fix cycle uses prefix limit" bash "$B" "$T/b.json" fix_cycles_DEV-1
assert_pass "independent per-task counter" jq -e '.counts["fix_cycles_DEV-1"]==1 and (.counts["fix_cycles_DEV-2"]==null)' "$T/b.json"
assert_fail "unknown counter refused"      "no budget limit" bash "$B" "$T/b.json" vibes
assert_pass "--check does not increment"   bash "$B" --check "$T/b.json" fix_cycles_DEV-1
assert_pass "check left count at 1"        jq -e '.counts["fix_cycles_DEV-1"]==1' "$T/b.json"
finish
