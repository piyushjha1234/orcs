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
  awk -F'\t' 'BEGIN{OFS="\t"} $2=="requirement" {$1="2026-11-07T10:02:00Z"} $2=="architecture" {$1="2026-11-07T10:03:00Z"} $2=="test-report" {$1="2026-11-07T10:30:00Z"} {print}' "$TD/approvals.log" > "$X/l" && mv "$X/l" "$TD/approvals.log"
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
# --- review fixes ---
setup; jq '.events += [{ts:"2026-11-07T11:00:00Z",stage:"orchestrator",field:"owner_wait_start",value:null},{ts:"2026-11-07T13:00:00Z",stage:"orchestrator",field:"owner_wait_end",value:null}]' "$TD/execution-trace.json" > "$X/t" && mv "$X/t" "$TD/execution-trace.json"
assert_pass "wait after delivery not subtracted" bash -c "$(declare -f sc); P='$P' X='$X' HIST='$HIST' SC='$SC'; sc >/dev/null && jq -e '.inputs.owner_wait_minutes==10 and .inputs.harness_minutes==20' '$TD/score.json'"
setup; jq '.events = [{ts:"2026-11-07T10:20:00Z",stage:"o",field:"owner_wait_start",value:null},{ts:"2026-11-07T12:00:00Z",stage:"o",field:"owner_wait_end",value:null}]' "$TD/execution-trace.json" > "$X/t" && mv "$X/t" "$TD/execution-trace.json"
assert_pass "wait straddling end clipped"        bash -c "$(declare -f sc); P='$P' X='$X' HIST='$HIST' SC='$SC'; sc >/dev/null && jq -e '.inputs.owner_wait_minutes==10' '$TD/score.json'"
setup; : > "$TR/s.jsonl"
assert_fail "zero measured tokens refused"       "no assistant messages" sc
setup; rm "$TD/budgets.json"
assert_fail "missing budgets refused"            "budgets" sc
assert_pass "score.sh never creates budgets"     test ! -e "$TD/budgets.json"
setup; jq '.limits.analyst_iterations=2' "$TD/budgets.json" > "$X/b" && mv "$X/b" "$TD/budgets.json"
(cd "$P" && for i in 1 2 3; do bash "$H/budgets.sh" executions/ORCS-001/budgets.json analyst_iterations >/dev/null 2>&1; done)
jq '.limits.analyst_iterations=5' "$TD/budgets.json" > "$X/b" && mv "$X/b" "$TD/budgets.json"
assert_pass "raised limit keeps traced breach"   bash -c "$(declare -f sc); P='$P' X='$X' HIST='$HIST' SC='$SC'; sc >/dev/null && jq -e '.inputs.penalties.budget_breaches==1' '$TD/score.json'"
setup; printf '## Project ORCS-001 — x\n### User Feedback\nok\n## Project ORCS-0010 — y\n### User Feedback\nSATISFACTION: 10/10\n' > "$P/docs/07-observer-report.md"
assert_pass "other run's rating not used"        bash -c "$(declare -f sc); P='$P' X='$X' HIST='$HIST' SC='$SC'; sc >/dev/null 2>&1; jq -e '.status==\"pending\"' '$TD/score.json'"
setup; printf '## Project ORCS-001 — x\n### Score\nSATISFACTION: 10/10\n### User Feedback\nok\n' > "$P/docs/07-observer-report.md"
assert_pass "rating outside User Feedback ignored" bash -c "$(declare -f sc); P='$P' X='$X' HIST='$HIST' SC='$SC'; sc >/dev/null 2>&1; jq -e '.status==\"pending\"' '$TD/score.json'"
setup; report ""
assert_pass "pending exits 3"                    bash -c "$(declare -f sc); P='$P' X='$X' HIST='$HIST' SC='$SC'; sc >/dev/null 2>&1; [ \$? -eq 3 ]"
setup
assert_pass "overrides recorded"                 bash -c "$(declare -f sc); P='$P' X='$X' HIST='$HIST' SC='$SC'; sc >/dev/null && jq -e '.inputs.overrides.ORCS_TRANSCRIPTS_ROOT != null' '$TD/score.json'"
setup; jq '.started_at="2026-11-07T12:00:00Z"' "$TD/execution-trace.json" > "$X/t" && mv "$X/t" "$TD/execution-trace.json"
assert_fail "start after delivery refused"       "started_at" sc
setup; jq '.runs=[{status:"PASS",reason:"merged"}]' "$TD/integration.json" > "$X/i" && mv "$X/i" "$TD/integration.json"
jq '.events += [{ts:"2026-11-07T10:20:00Z",stage:"integration",field:"scope_violation",value:"DEV-1"}]' "$TD/execution-trace.json" > "$X/t" && mv "$X/t" "$TD/execution-trace.json"
assert_pass "pruned integration runs still penalised" bash -c "$(declare -f sc); P='$P' X='$X' HIST='$HIST' SC='$SC'; sc >/dev/null && jq -e '.inputs.penalties.scope_rejections==1' '$TD/score.json'"
jq -cn '{status:"final",task_id:"ORCS-9",project:"/p",score:95}' > "$HIST"; jq -cn '{status:"final",task_id:"ORCS-9",project:"/p",score:79,rescore:true}' >> "$HIST"
assert_pass "superseded record not best"         bash -c "cd '$X' && rm -rf executions && ORCS_SCORES_FILE='$HIST' bash '$H/init-run.sh' ORCS-50 >/dev/null && jq -e '.best==79 and .beat==79' executions/ORCS-50/target.json"
finish
