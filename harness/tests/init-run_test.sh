#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
I="$H/init-run.sh"
P=$(mktemp -d); trap 'rm -rf "$P"' EXIT
assert_pass "init creates run"        bash -c "cd '$P' && bash '$I' ORCS-007"
assert_pass "task dir exists"         test -d "$P/executions/ORCS-007"
assert_pass "ACTIVE points at run"    grep -qx "ORCS-007" "$P/executions/ACTIVE"
assert_pass ".orcs links to kit"      test -x "$P/.orcs/harness/validate-contract.sh"
assert_pass "budgets initialised"     jq -e '.limits.analyst_iterations==2' "$P/executions/ORCS-007/budgets.json"
assert_pass "trace initialised"       jq -e '.tokens==null and (.events|length)==0' "$P/executions/ORCS-007/execution-trace.json"
assert_fail "refuses bad task id"     "task id"            bash -c "cd '$P' && bash '$I' 'bad id'"
assert_fail "refuses second active"   "already active"     bash -c "cd '$P' && bash '$I' ORCS-008"
finish
