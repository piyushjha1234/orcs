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
assert_pass "trace has ISO started_at"      jq -e '.started_at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")' "$P/executions/ORCS-007/execution-trace.json"
C=$(mktemp -d); sed 's/^W_COMPLETION=5$/W_COMPLETION=4/' "$ROOT/knowledge/scoring.conf" > "$C/bad.conf"
assert_fail "weights must sum to 100"       "sum to 100" bash -c "source '$H/lib/common.sh'; load_scoring_conf '$C/bad.conf'"
assert_pass "shipped conf loads"            bash -c "source '$H/lib/common.sh'; load_scoring_conf '$ROOT/knowledge/scoring.conf' && [ \"\$REF_TOKENS_PER_BR\" = 150000 ] && [ \"\$QUALITY_CAP\" = 60 ]"
rm -rf "$C"
finish
