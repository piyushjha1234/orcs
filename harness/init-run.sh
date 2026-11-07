#!/usr/bin/env bash
# init-run.sh <task-id>   (run from the project root)
# Starts an Orcs run: executions/<task-id>/ with budgets + trace, executions/ACTIVE,
# and a .orcs symlink to the installed kit so agents can call .orcs/harness/*.
source "$(dirname "$0")/lib/common.sh"
[ $# -eq 1 ] || die "usage: init-run.sh <task-id>"
id="$1"
[[ "$id" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || die "invalid task id: '$id' (letters, digits, - and _ only)"
kit="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p executions
if [ -f executions/ACTIVE ]; then
  cur=$(tr -d '[:space:]' < executions/ACTIVE)
  [ "$cur" = "$id" ] || die "run $cur already active — finish it or delete executions/ACTIVE first"
fi
dir="executions/$id"; mkdir -p "$dir"
[ -e .orcs ] || ln -s "$kit" .orcs
[ -f "$dir/budgets.json" ] || jq -n '{limits:{analyst_iterations:2, architect_iterations:2, fix_cycles:3, tester_cycles:2, workflow_retries:3, unapproved_dependencies:0, concurrent_developers:3}, counts:{}}' > "$dir/budgets.json"
[ -f "$dir/execution-trace.json" ] || jq -n --arg id "$id" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{task_id:$id, started_at:$ts, tokens:null, cost_usd:null, events:[]}' > "$dir/execution-trace.json"
touch "$dir/done.txt"
echo "$id" > executions/ACTIVE
echo "OK: run $id started at $dir (kit: $kit)"

# Target: beat the latest final score; focus on the factor with the largest weighted gap.
hist=$(scores_file)
# keep only the latest record per (task_id, project): a rescore supersedes the earlier one
target=$( { [ -s "$hist" ] && jq -s 'map(select(.status == "final")) | to_entries | group_by([.value.task_id, .value.project]) | map(.[-1]) | sort_by(.key) | map(.value)' "$hist" 2>/dev/null; } || echo '[]')
jq -n --argjson h "$target" '
  if ($h | length) == 0 then {beat: null, best: null, focus: null, focus_gap: null}
  else ($h[-1]) as $l |
    ([ ($l.factors // {}) | to_entries[] | {k: .key, gap: ((1 - (.value // 0)) * (($l.weights // {})[.key] // 0))} ] | max_by(.gap)) as $f |
    {beat: $l.score, best: ($h | map(.score) | max), focus: $f.k, focus_gap: (if $f == null then null else (($f.gap * 10 | round) / 10) end), last_task: $l.task_id}
  end' > "$dir/target.json"
jq -r 'if .beat == null then "TARGET: no previous score — this run sets the baseline. Aim for 100."
       else "TARGET: beat \(.beat)/100 (best \(.best)) → aim for 100. Weakest factor last run: \(.focus) (\(.focus_gap) points lost). Quality first: efficiency never at the cost of acceptance criteria." end' "$dir/target.json"
