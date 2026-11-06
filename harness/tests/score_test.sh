#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
SC="$H/score.sh"; AP="$H/approve.sh"
X=$(cd "$(mktemp -d)" && pwd -P); trap 'rm -rf "$X"' EXIT
P="$X/proj"; TD="$P/executions/ORCS-001"; HIST="$X/history.jsonl"
SLUG=$(printf '%s' "$P" | sed 's/[^A-Za-z0-9]/-/g'); TR="$X/transcripts/$SLUG"
msg() { jq -cn --arg id "$1" --arg ts "$2" --argjson o "$3" '{type:"assistant", timestamp:$ts, message:{id:$id, usage:{input_tokens:0, output_tokens:$o, cache_creation_input_tokens:0, cache_read_input_tokens:0}}}'; }
setup() { # perfect run: 2 BR-IDs, 30 min window, 10 min owner wait, 1000 tokens, all pass
  rm -rf "$P" "$X/transcripts" "$HIST"; mkdir -p "$P/docs" "$TR"
  (cd "$P" && bash "$H/init-run.sh" ORCS-001 >/dev/null)
  jq '.started_at="2026-11-07T10:00:00Z" | .events=[
        {ts:"2026-11-07T10:05:00Z",stage:"orchestrator",field:"owner_wait_start",value:null},
        {ts:"2026-11-07T10:15:00Z",stage:"orchestrator",field:"owner_wait_end",value:null}]' "$TD/execution-trace.json" > "$X/t" && mv "$X/t" "$TD/execution-trace.json"
  bash "$AP" "$TD" requirement "$FX/requirement/valid.json" owner >/dev/null
  bash "$AP" "$TD" architecture "$FX/architecture/valid.json" owner >/dev/null
  bash "$AP" "$TD" test-report "${1:-$FX/test-report/valid.json}" owner >/dev/null || echo "SETUP: test-report approval failed"
  awk -F'\t' 'BEGIN{OFS="\t"} $2=="test-report" {$1="2026-11-07T10:30:00Z"} {print}' "$TD/approvals.log" > "$X/l" && mv "$X/l" "$TD/approvals.log"
  jq -n '{task_id:"ORCS-001", merged:["DEV-1"], runs:[{ts:"t",microtask:"DEV-1",status:"PASS",reason:"merged"}], overall_status:"PASS"}' > "$TD/integration.json"
  msg m1 2026-11-07T10:10:00.000Z 1000 > "$TR/s.jsonl"
  report "SATISFACTION: 10/10"
}
report() { printf '## Project ORCS-001 — 2026-11-07\n### Score\n### User Feedback\nok\n<!-- write SATISFACTION: n/10 -->\n%s\n### Owner Approval\nAPPROVED: none\n' "$1" > "$P/docs/07-observer-report.md"; }
sc() { (cd "$P" && ORCS_SCORES_FILE="$HIST" ORCS_TRANSCRIPTS_ROOT="$X/transcripts" bash "$SC" executions/ORCS-001 "$@"); }
score_is() { jq -e --argjson s "$1" '.score == $s' "$TD/score.json" >/dev/null; }

setup
assert_pass "perfect run scores"                  sc
assert_pass "perfect run = 100"                   score_is 100
assert_pass "status final"                        jq -e '.status=="final"' "$TD/score.json"
assert_pass "one history record"                  bash -c "[ \$(wc -l < '$HIST') -eq 1 ]"
assert_pass "history stores weights + refs"       jq -e '.weights.correctness==35 and .refs.tokens_per_br==150000' "$HIST"
assert_fail "second scoring refused"              "already scored" sc
assert_pass "--rescore appends"                   sc --rescore
assert_pass "rescore record marked"               bash -c "tail -1 '$HIST' | jq -e '.rescore==true'"

jq '.results[0].status="FAIL" | .overall_status="FAIL"' "$FX/test-report/valid.json" > "$X/fail.json"; setup "$X/fail.json"
assert_pass "failing BR still scores"             sc
assert_pass "failing BR capped at 60"             score_is 60
assert_pass "cap recorded"                        jq -e '.capped==true and .factors.correctness==0.5' "$TD/score.json"

setup
jq '.runs = [{status:"FAIL",reason:"scope gate — x"},{status:"FAIL",reason:"unit tests failed: t"},{status:"PASS",reason:"merged"}]' "$TD/integration.json" > "$X/i" && mv "$X/i" "$TD/integration.json"
jq '.events += [{ts:"2026-11-07T10:20:00Z",stage:"developer",field:"blocker",value:"x"}]' "$TD/execution-trace.json" > "$X/t" && mv "$X/t" "$TD/execution-trace.json"
jq '.counts.analyst_iterations=3' "$TD/budgets.json" > "$X/b" && mv "$X/b" "$TD/budgets.json"
assert_pass "penalised run scores"                sc
assert_pass "quality = 1-.10-.05-.03-.15 → 93.4"  score_is 93.4
assert_pass "penalties itemised"                  jq -e '.inputs.penalties == {scope_rejections:1, rework:1, escalations:0, blockers:1, budget_breaches:1}' "$TD/score.json"

setup; sed 's/^REF_MINUTES_PER_BR=15$/REF_MINUTES_PER_BR=10/' "$ROOT/knowledge/scoring.conf" > "$X/c.conf"
assert_pass "owner wait excluded → speed full"    bash -c "cd '$P' && ORCS_SCORING_CONF='$X/c.conf' ORCS_SCORES_FILE='$HIST' ORCS_TRANSCRIPTS_ROOT='$X/transcripts' bash '$SC' executions/ORCS-001 >/dev/null && jq -e '.score==100 and .inputs.harness_minutes==20 and .inputs.owner_wait_minutes==10' '$TD/score.json'"
setup; jq '.events=[]' "$TD/execution-trace.json" > "$X/t" && mv "$X/t" "$TD/execution-trace.json"
assert_pass "no wait events → slower → 96.7"      bash -c "cd '$P' && ORCS_SCORING_CONF='$X/c.conf' ORCS_SCORES_FILE='$HIST' ORCS_TRANSCRIPTS_ROOT='$X/transcripts' bash '$SC' executions/ORCS-001 >/dev/null && jq -e '.score==96.7' '$TD/score.json'"

setup; msg m2 2026-11-07T10:20:00.000Z 599000 >> "$TR/s.jsonl"
assert_pass "tokens 2x ref → 95"                  bash -c "$(declare -f sc); P='$P' X='$X' HIST='$HIST' SC='$SC'; sc >/dev/null && jq -e '.score==95 and .factors.tokens==0.5' '$TD/score.json'"

setup; report "SATISFACTION: 7/10"
assert_pass "satisfaction 7/10 → 94"              bash -c "$(declare -f sc); P='$P' X='$X' HIST='$HIST' SC='$SC'; sc >/dev/null && jq -e '.score==94' '$TD/score.json'"

for bad in "" "SATISFACTION: great" "SATISFACTION: 11/10" "SATISFACTION: 7"; do
  setup; report "$bad"
  assert_pass "pending on '${bad:-missing}'"       bash -c "$(declare -f sc); P='$P' X='$X' HIST='$HIST' SC='$SC'; sc >/dev/null 2>&1; jq -e '.status==\"pending\" and .score==null' '$TD/score.json'"
  assert_pass "pending writes no history"          bash -c "[ ! -s '$HIST' ]"
done

setup; jq '.flaws=[{"requirement_id":"BR-1","description":"edited"}]' "$TD/test-report.approved.json" > "$X/x" && mv "$X/x" "$TD/test-report.approved.json"
assert_fail "tampered test report refused"        "changed after" sc
finish
