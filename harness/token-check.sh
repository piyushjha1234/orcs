#!/usr/bin/env bash
# token-check.sh <task-dir>   (run before every dispatch wave)
# Mid-run token guardrail. Measures the run's effective tokens so far with tokens.sh (trace
# started_at → now, from Claude Code's own transcripts) against the run's reference budget,
# REF_TOKENS_PER_BR (knowledge/scoring.conf) × approved BR-IDs (requirement.approved.json,
# else the draft requirement.json, else 1).
# Thresholds: budgets.json limits.token_warn_pct (default 80) and token_stop_pct (default 150).
#   below warn → "OK: …"                                       exit 0
#   ≥ warn     → "WARN: …" — tell the owner in one line       exit 0
#   ≥ stop     → "TOKEN BUDGET STOP: …" — stop, ask the owner  exit 1 (traced budget_breach)
# The owner continues a stopped run by raising limits.token_stop_pct in budgets.json.
# Tokens that cannot be measured (no transcripts) give a WARN and exit 0: this guard never
# blocks a run on its own measurement gap; score.sh still fails loud at the end.
HD="$(cd "$(dirname "$0")" && pwd)"
source "$HD/lib/common.sh"
[ $# -eq 1 ] || die "usage: token-check.sh <task-dir>"
td="$1"
[ -d "$td" ] || die "task dir not found: $td"
trace="$td/execution-trace.json"; require_json_file "$trace"
load_scoring_conf "${ORCS_SCORING_CONF:-$HD/../knowledge/scoring.conf}"
start=$(jq -r '.started_at // empty' "$trace"); [ -n "$start" ] || die "trace has no started_at (run init-run.sh)"
proj="$(cd "$td/../.." && pwd)"

warn=80; stop=150
if [ -f "$td/budgets.json" ]; then
  warn=$(jq -r '.limits.token_warn_pct // 80' "$td/budgets.json"); stop=$(jq -r '.limits.token_stop_pct // 150' "$td/budgets.json")
fi
for v in "$warn" "$stop"; do [[ "$v" =~ ^[1-9][0-9]*$ ]] || die "token_warn_pct / token_stop_pct must be positive integers, got: $v"; done
[ "$warn" -lt "$stop" ] || die "token_warn_pct ($warn) must be below token_stop_pct ($stop)"

nbr=1
for f in "$td/requirement.approved.json" "$td/requirement.json"; do
  [ -f "$f" ] && { nbr=$(jq -r '(.requirements // []) | length' "$f"); break; }
done
[[ "$nbr" =~ ^[0-9]+$ ]] && [ "$nbr" -gt 0 ] || nbr=1
ref=$((REF_TOKENS_PER_BR * nbr))

if ! out=$(bash "$HD/tokens.sh" "$proj" "$start" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" 2>&1); then
  echo "WARN: tokens unmeasurable for this run — $(tail -1 <<<"$out"). Guard skipped; tell the owner."
  exit 0
fi
eff=$(jq -r '.effective' <<<"$out")
[[ "$eff" =~ ^[0-9]+$ ]] || die "tokens.sh returned no effective count: $out"
pct=$((eff * 100 / ref))
line="$eff effective tokens = $pct% of reference $ref ($nbr BR-IDs × $REF_TOKENS_PER_BR)"
if [ "$pct" -ge "$stop" ]; then
  # one breach event per stop level: re-checking while still over the same line is not a new breach
  jq -e --arg v "tokens over stop $stop%" 'any(.events[]?; .field == "budget_breach" and .value == $v)' "$trace" >/dev/null 2>&1 \
    || trace_event "$trace" budget_breach "tokens over stop $stop%" tokens
  echo "orcs-harness: TOKEN BUDGET STOP: $line — at or over the $stop% stop line. Stop, keep state, ask the owner before any new dispatch." >&2
  exit 1
elif [ "$pct" -ge "$warn" ]; then
  echo "WARN: $line — past the $warn% warning line (stop at $stop%)."
else
  echo "OK: $line"
fi
