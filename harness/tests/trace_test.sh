#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
TR="$H/trace.sh"
P=$(mktemp -d); trap 'rm -rf "$P"' EXIT
(cd "$P" && bash "$H/init-run.sh" ORCS-001 >/dev/null)
t() { (cd "$P" && bash "$TR" "$@"); }
F="$P/executions/ORCS-001/execution-trace.json"
assert_pass "append stage_start"            t ORCS-001 stage_start null analyst
assert_pass "append numeric iteration"      t ORCS-001 iteration 2 analyst
assert_pass "append string blocker"         t ORCS-001 blocker "DEV-1 needs schema for orders" developer
assert_pass "events recorded in order"      jq -e '[.events[].field] == ["stage_start","iteration","blocker"]' "$F"
assert_pass "numeric value kept as number"  jq -e '.events[1].value == 2' "$F"
assert_pass "string value kept as string"   jq -e '.events[2].value | startswith("DEV-1")' "$F"
assert_pass "stage recorded"                jq -e '.events[2].stage == "developer"' "$F"
assert_pass "token fields stay null"        jq -e '.tokens == null and .cost_usd == null' "$F"
assert_pass "trace still a valid contract"  bash "$H/validate-contract.sh" execution-trace "$F"
assert_fail "unknown field refused"         "invalid event field" t ORCS-001 vibes 1
assert_fail "unknown run refused"           "no trace" t ORCS-404 iteration 1
finish
