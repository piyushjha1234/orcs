#!/usr/bin/env bash
# score.sh <task-dir> [--rescore]   (run from the project root)
# Deterministic reward score (0-100) for one finished Orcs run — no LLM involved.
# Spec: docs/superpowers/specs/2026-11-07-orcs-reward-score-design.md
#
#   correctness  approved BR-IDs passing / approved BR-IDs        (test-report.approved.json)
#   quality      1 - penalties, floor 0                           (integration.json, trace, budgets)
#   satisfaction SATISFACTION: n/10 in the run's observer section (docs/07-observer-report.md)
#   tokens       min(1, ref / measured tokens per BR-ID)          (tokens.sh, Claude Code transcripts)
#   speed        min(1, ref / harness minutes per BR-ID)          (trace started_at → test-report
#                                                                  approval, minus owner waits)
#   completion   micro-tasks merged / micro-tasks planned
# Weighted per knowledge/scoring.conf. Any failing approved BR-ID caps the score at QUALITY_CAP.
# Without a valid satisfaction line the score is "pending" and nothing is recorded.
# Writes <task-dir>/score.json; a final score is appended to the history (scores_file).
HD="$(cd "$(dirname "$0")" && pwd)"
source "$HD/lib/common.sh"
rescore=0; args=()
for a in "$@"; do [ "$a" = "--rescore" ] && rescore=1 || args+=("$a"); done
[ ${#args[@]} -eq 1 ] || die "usage: score.sh <task-dir> [--rescore]"
td="${args[0]}"; [ -d "$td" ] || die "task dir not found: $td"
td="$(cd "$td" && pwd -P)"; proj="$(cd "$td/../.." && pwd -P)"
conf="${ORCS_SCORING_CONF:-$HD/../knowledge/scoring.conf}"
load_scoring_conf "$conf"
for k in requirement architecture test-report; do msg=$(verify_approved "$td" "$k") || die "$msg"; done
trace="$td/execution-trace.json"; require_json_file "$trace"
ijson="$td/integration.json"; require_json_file "$ijson"
budgets="$td/budgets.json"; [ -f "$budgets" ] || echo '{"limits":{},"counts":{}}' > "$budgets"
task=$(jq -r .task_id "$td/requirement.approved.json")
hist=$(scores_file)

start=$(jq -r '.started_at // empty' "$trace"); [ -n "$start" ] || die "trace has no started_at (run init-run.sh) — cannot time the run"
end=$(awk -F'\t' '$2=="test-report" {t=$1} END {print t}' "$td/approvals.log")
[ -n "$end" ] || die "no test-report approval in $td/approvals.log — delivery not complete"
tokens=$(bash "$HD/tokens.sh" "$proj" "$start" "$end") || exit 1

# Satisfaction: last 'SATISFACTION: n/10' (n = 0..10) in this run's '## Project <id>' section,
# HTML comments ignored. Anything else → pending.
report="${ORCS_REPORT:-$proj/docs/07-observer-report.md}"
sat=""
if [ -r "$report" ]; then
  sat=$(awk -v id="$task" '/^## Project /{insec = (index($0, "## Project " id) == 1)} insec' "$report" \
    | perl -0pe 's/<!--.*?-->//gs' \
    | sed -nE 's/^[[:space:]]*SATISFACTION:[[:space:]]*([0-9]|10)[[:space:]]*\/[[:space:]]*10[[:space:]]*$/\1/p' | tail -1)
fi

result=$(jq -n \
  --slurpfile req "$td/requirement.approved.json" --slurpfile arch "$td/architecture.approved.json" \
  --slurpfile tr "$td/test-report.approved.json" --slurpfile ij "$ijson" --slurpfile trace "$trace" \
  --slurpfile bud "$budgets" --argjson tok "$tokens" --arg sat "$sat" --arg task "$task" --arg proj "$proj" \
  --arg start "$start" --arg end "$end" \
  --argjson w "{\"correctness\":$W_CORRECTNESS,\"quality\":$W_QUALITY,\"satisfaction\":$W_SATISFACTION,\"tokens\":$W_TOKENS,\"speed\":$W_SPEED,\"completion\":$W_COMPLETION}" \
  --argjson pen "{\"scope_rejections\":$P_SCOPE_REJECTION,\"rework\":$P_REWORK,\"escalations\":$P_ESCALATION,\"blockers\":$P_BLOCKER,\"budget_breaches\":$P_BUDGET_BREACH}" \
  --argjson ref "{\"tokens_per_br\":$REF_TOKENS_PER_BR,\"minutes_per_br\":$REF_MINUTES_PER_BR}" \
  --argjson cap "$QUALITY_CAP" '
  def t: sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601;
  def r1: (. * 10 | round) / 10;
  def r3: (. * 1000 | round) / 1000;
  ($req[0].requirements | map(.id)) as $brs | ($brs | length) as $n |
  # correctness: a BR passes only if it has a PASS result and no FAIL result
  ([ $brs[] as $b | select(any($tr[0].results[]; .requirement_id == $b and .status == "PASS")
                           and (any($tr[0].results[]; .requirement_id == $b and .status == "FAIL") | not)) ] | length) as $passed |
  ($passed / $n) as $c |
  # process-quality penalties
  ([ $ij[0].runs[]? | select(.status == "FAIL") | .reason // "" ]) as $fails |
  { scope_rejections: ([ $fails[] | select(startswith("scope gate") or startswith("scope audit")) ] | length),
    escalations:      ([ $fails[] | select(startswith("escalate")) ] | length),
    rework:           ([ $fails[] | select((startswith("scope gate") or startswith("scope audit") or startswith("escalate")) | not) ] | length),
    blockers:         ([ $trace[0].events[]? | select(.field == "blocker") ] | length),
    budget_breaches:  ([ $bud[0].counts // {} | to_entries[] | . as $e
                         | (($bud[0].limits[$e.key]) // ($bud[0].limits[$e.key | sub("_DEV-[0-9]+$"; "")])) as $lim
                         | select($lim != null and $e.value > $lim) ] | length) } as $pc |
  ([ $pc | to_entries[] | .value * $pen[.key] ] | add) as $deduct |
  ([1 - $deduct, 0] | max) as $q |
  # owner waits: pair start/end events in time order; unmatched count as harness time
  ([ $trace[0].events[]? | select(.field == "owner_wait_start" or .field == "owner_wait_end") ] | sort_by(.ts | t)
   | reduce .[] as $e ({open: null, total: 0};
       if $e.field == "owner_wait_start" then (if .open == null then .open = ($e.ts | t) else . end)
       elif .open != null then .total += (($e.ts | t) - .open) | .open = null else . end) | .total) as $wait |
  ((($end | t) - ($start | t) - $wait) / 60) as $hmin |
  ([$hmin, 0] | max) as $hmin |
  ($tok.effective / $n) as $tpb | ($hmin / $n) as $mpb |
  (if $tpb <= 0 then 1 else ([1, $ref.tokens_per_br / $tpb] | min) end) as $et |
  (if $mpb <= 0 then 1 else ([1, $ref.minutes_per_br / $mpb] | min) end) as $eh |
  ([ $arch[0].microtasks[].task_id ]) as $planned |
  (([ $ij[0].merged[]? ] - ($ij[0].merged - $planned)) | unique | length) as $merged_ok |
  ($merged_ok / ($planned | length)) as $d |
  (if $sat == "" then null else ($sat | tonumber) / 10 end) as $s |
  { correctness: ($c | r3), quality: ($q | r3), satisfaction: $s, tokens: ($et | r3), speed: ($eh | r3), completion: ($d | r3) } as $f |
  (if $s == null then null else
     ($w.correctness * $c + $w.quality * $q + $w.satisfaction * $s + $w.tokens * $et + $w.speed * $eh + $w.completion * $d) end) as $raw |
  { task_id: $task, project: $proj,
    status: (if $s == null then "pending" else "final" end),
    score: (if $raw == null then null elif $c < 1 then ([$raw, $cap] | min | r1) else ($raw | r1) end),
    raw_score: (if $raw == null then null else ($raw | r1) end),
    capped: ($raw != null and $c < 1 and $raw > $cap),
    factors: $f,
    points: (if $s == null then null else ($f | with_entries(.value = ((.value * $w[.key]) | r1))) end),
    inputs: { br_count: $n, br_passed: $passed, penalties: $pc, tokens: $tok,
              tokens_per_br: ($tpb | floor), run_start: $start, run_end: $end,
              owner_wait_minutes: ($wait / 60 | r1), harness_minutes: ($hmin | r1),
              microtasks_planned: ($planned | length), microtasks_merged: $merged_ok },
    weights: $w, refs: $ref, penalties: $pen, quality_cap: $cap }') || die "could not compute score"

if [ "$(jq -r .status <<<"$result")" = "pending" ]; then
  jq . <<<"$result" > "$td/score.json"
  echo "PENDING: no valid 'SATISFACTION: n/10' (n = 0..10) in the '## Project $task' section of $report — score not recorded." >&2
  exit 0
fi

mkdir -p "$(dirname "$hist")"; touch "$hist"
already=$(jq -c --arg t "$task" --arg p "$proj" 'select(.task_id == $t and .project == $p)' "$hist") || die "score history is not valid JSON lines: $hist"
if [ "$rescore" -eq 0 ] && [ -n "$already" ]; then
  die "$task in $proj is already scored in $hist — use --rescore to append a superseding record"
fi
prev=$(jq -s 'map(select(.status == "final")) | (if length > 0 then .[-1].score else null end)' "$hist")
best=$(jq -s 'map(select(.status == "final")) | (map(.score) | max)' "$hist")
final=$(jq -c --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson rs "$rescore" '. + {scored_at: $ts, rescore: ($rs == 1)}' <<<"$result")
jq . <<<"$final" > "$td/score.json"
echo "$final" >> "$hist"

jq -r --argjson prev "$prev" --argjson best "$best" '
  "ORCS SCORE \(.task_id): \(.score)/100" + (if .capped then "  (capped: \(.inputs.br_count - .inputs.br_passed) approved BR-ID(s) not passing; raw \(.raw_score))" else "" end),
  "  previous: \($prev // "none")   best before: \($best // "none")",
  (.points | to_entries[] | "  \(.key): \(.value) / \($ARGS.named.w[.key] // "")"),
  "  tokens/BR \(.inputs.tokens_per_br) (ref \(.refs.tokens_per_br)) · harness min \(.inputs.harness_minutes) (+\(.inputs.owner_wait_minutes) waiting on owner) · penalties \(.inputs.penalties | tostring)"
' --argjson w "$(jq -c .weights <<<"$final")" <<<"$final"
