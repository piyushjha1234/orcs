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
Q=$(mktemp -d)
OUT=$(cd "$Q" && ORCS_SCORES_FILE="$Q/none.jsonl" bash "$I" ORCS-100 2>&1)
assert_pass "no history → baseline message"   grep -qi "baseline" <<<"$OUT"
assert_pass "no history → beat null"          jq -e '.beat == null and .best == null' "$Q/executions/ORCS-100/target.json"
R=$(mktemp -d)
jq -cn '{status:"final",task_id:"ORCS-1",score:80,weights:{correctness:35,quality:20,satisfaction:20,tokens:10,speed:10,completion:5},factors:{correctness:1,quality:1,satisfaction:1,tokens:0.2,speed:1,completion:1}}' > "$R/h.jsonl"
jq -cn '{status:"final",task_id:"ORCS-2",score:70,weights:{correctness:35,quality:20,satisfaction:20,tokens:10,speed:10,completion:5},factors:{correctness:1,quality:0.5,satisfaction:0.9,tokens:0.5,speed:1,completion:1}}' >> "$R/h.jsonl"
OUT=$(cd "$R" && ORCS_SCORES_FILE="$R/h.jsonl" bash "$I" ORCS-3 2>&1)
assert_pass "beat = latest score"             jq -e '.beat == 70' "$R/executions/ORCS-3/target.json"
assert_pass "best = max score"                jq -e '.best == 80' "$R/executions/ORCS-3/target.json"
assert_pass "focus = largest weighted gap"    jq -e '.focus == "quality" and .focus_gap == 10' "$R/executions/ORCS-3/target.json"
assert_pass "target announced"                grep -q "beat 70" <<<"$OUT"
rm -rf "$Q" "$R"
finish
