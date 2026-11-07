#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
TC="$H/token-check.sh"; AP="$H/approve.sh"
X=$(mktemp -d); trap 'rm -rf "$X"' EXIT
PROJ="$X/proj"; TD="$PROJ/executions/ORCS-001"; mkdir -p "$TD"
SLUG=$(printf '%s' "$(cd "$PROJ" && pwd)" | sed 's/[^A-Za-z0-9]/-/g'); TR="$X/transcripts/$SLUG"; mkdir -p "$TR"
CONF="$X/scoring.conf"; sed 's/^REF_TOKENS_PER_BR=.*/REF_TOKENS_PER_BR=1000/' "$H/../knowledge/scoring.conf" > "$CONF"
jq -n '{task_id:"ORCS-001", started_at:"2026-01-01T00:00:00Z", events:[]}' > "$TD/execution-trace.json"
jq -n '{limits:{token_warn_pct:80, token_stop_pct:150}, counts:{}}' > "$TD/budgets.json"
bash "$AP" "$TD" requirement "$FX/requirement/valid.json" owner >/dev/null   # 2 BR-IDs → reference 2000
spend() { # spend <input-tokens> — one assistant message, now
  jq -cn --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson i "$1" '{type:"assistant", timestamp:$ts, message:{id:"m", usage:{input_tokens:$i, output_tokens:0, cache_creation_input_tokens:0, cache_read_input_tokens:0}}}' > "$TR/s.jsonl"
}
run() { ORCS_TRANSCRIPTS_ROOT="$X/transcripts" ORCS_SCORING_CONF="$CONF" bash "$TC" "$TD"; }
says() { run | grep -q "$1"; }   # says <regex> — exit 0 and stdout matches

spend 1000
assert_pass "under warn line passes"         says '^OK: 1000 effective tokens = 50% of reference 2000'
spend 1700
assert_pass "warn line exits 0 with WARN"     says '^WARN: .*85%'
spend 3000
assert_fail "stop line exits 1"               "TOKEN BUDGET STOP" run
assert_pass "stop traced as budget breach"    jq -e '[.events[] | select(.field=="budget_breach")] | length == 1' "$TD/execution-trace.json"
run >/dev/null 2>&1
assert_pass "re-check over same line not re-traced" jq -e '[.events[] | select(.field=="budget_breach")] | length == 1' "$TD/execution-trace.json"
jq '.limits.token_stop_pct = 200' "$TD/budgets.json" > "$X/b" && mv "$X/b" "$TD/budgets.json"
assert_pass "owner raising stop line continues" run
jq '.limits.token_warn_pct = 300' "$TD/budgets.json" > "$X/b" && mv "$X/b" "$TD/budgets.json"
assert_fail "warn must be below stop"         "must be below" run
jq '.limits.token_warn_pct = 80' "$TD/budgets.json" > "$X/b" && mv "$X/b" "$TD/budgets.json"
assert_pass "unmeasurable tokens warn, never block" bash -c "ORCS_TRANSCRIPTS_ROOT='$X/none' ORCS_SCORING_CONF='$CONF' bash '$TC' '$TD' | grep -q 'WARN: tokens unmeasurable'"
finish
