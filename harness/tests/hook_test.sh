#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
HOOK="$H/hooks/block-stage-advance.sh"; AP="$H/approve.sh"
P=$(mktemp -d); trap 'rm -rf "$P"' EXIT
mkdir -p "$P/executions/ORCS-001"
input() { printf '{"tool_name":"%s","tool_input":{"subagent_type":"%s"},"cwd":"%s"}' "$1" "$2" "$P"; }
hook() { input "$1" "$2" | CLAUDE_PROJECT_DIR="$P" bash "$HOOK"; }
blocked() { input "$1" "$2" | CLAUDE_PROJECT_DIR="$P" bash "$HOOK" >/dev/null 2>&1; [ $? -eq 2 ]; }

assert_pass "no ACTIVE run → allow"              hook Agent architect
echo ORCS-001 > "$P/executions/ACTIVE"
assert_pass "analyst never blocked"              hook Agent analyst
assert_pass "non-agent tool ignored"             hook Bash architect
assert_pass "architect blocked w/o approval"     blocked Agent architect
assert_pass "plugin-prefixed name gated"         blocked Agent orcs:architect
assert_pass "capitalised name gated"             blocked Agent Architect
assert_pass "padded name gated"                  blocked Agent " architect"
assert_pass "malformed stdin blocks in a run"    bash -c "echo 'not json' | CLAUDE_PROJECT_DIR='$P' bash '$HOOK' >/dev/null 2>&1; [ \$? -eq 2 ]"
mkdir -p "$P/sub/dir"
assert_pass "walks up to find ACTIVE"            bash -c "printf '{\"tool_name\":\"Agent\",\"tool_input\":{\"subagent_type\":\"architect\"},\"cwd\":\"%s\"}' '$P/sub/dir' | env -u CLAUDE_PROJECT_DIR bash '$HOOK' >/dev/null 2>&1; [ \$? -eq 2 ]"
assert_fail "architecture needs approved requirement first" "requirement" bash "$AP" "$P/executions/ORCS-001" architecture "$FX/architecture/valid.json" owner
assert_fail "approve rejects invalid contract"   "INVALID" bash "$AP" "$P/executions/ORCS-001" requirement "$FX/requirement/invalid-duplicate-brid.json" owner
assert_pass "approve valid requirement"          bash "$AP" "$P/executions/ORCS-001" requirement "$FX/requirement/valid.json" owner
assert_pass "approval logged"                    grep -q "requirement" "$P/executions/ORCS-001/approvals.log"
assert_pass "approval records sha256"            bash -c "awk -F'\t' '\$2==\"requirement\" {print \$5}' '$P/executions/ORCS-001/approvals.log' | grep -qE '^[0-9a-f]{64}\$'"
assert_pass "architect allowed after approval"   hook Agent architect
assert_pass "Task tool name also gated"          blocked Task developer
T2=$(mktemp -d); jq '.microtasks[0].dependencies=["DEV-1"]' "$FX/architecture/valid.json" > "$T2/cycle.json"
assert_fail "approve runs strict DAG check"      "cycle" bash "$AP" "$P/executions/ORCS-001" architecture "$T2/cycle.json" owner
assert_fail "approve checks coverage"            "BR-77" bash "$AP" "$P/executions/ORCS-001" architecture "$FX/architecture/invalid-unapproved-br.json" owner
rm -rf "$T2"
bash "$AP" "$P/executions/ORCS-001" architecture "$FX/architecture/valid.json" owner >/dev/null
assert_pass "developer allowed after arch approval" hook Agent developer
cp "$P/executions/ORCS-001/architecture.approved.json" "$T/arch.bak" 2>/dev/null || { T=$(mktemp -d); cp "$P/executions/ORCS-001/architecture.approved.json" "$T/arch.bak"; }
jq '.microtasks[0].allowed_files += ["src/billing.py"]' "$T/arch.bak" > "$P/executions/ORCS-001/architecture.approved.json"
assert_pass "valid edit after approval blocks"   blocked Agent developer
cp "$T/arch.bak" "$P/executions/ORCS-001/architecture.approved.json"
assert_pass "tester blocked w/o integration PASS" blocked Agent tester
echo '{"task_id":"ORCS-001","overall_status":"FAIL"}' > "$P/executions/ORCS-001/integration.json"
assert_pass "tester blocked on integration FAIL" blocked Agent tester
echo '{"task_id":"ORCS-001","overall_status":"PASS"}' > "$P/executions/ORCS-001/integration.json"
assert_pass "tester allowed on integration PASS" hook Agent tester
assert_pass "observer blocked w/o test approval" blocked Agent task-observer
echo '{"stage":"x"}' > "$P/executions/ORCS-001/requirement.approved.json"
assert_pass "tampered approved file blocks"      blocked Agent architect
finish
