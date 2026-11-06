#!/usr/bin/env bash
# dag-ready.sh [--strict] [--max N] <architecture.json> [done.txt]
# Default: print the next batch of ready micro-task ids (dependencies done, not done
# themselves), at most N (default 3), never two that share a file — an overlapping task is
# deferred to a later batch (stderr note). --strict: simulate every wave and fail on a
# same-wave file overlap, an unknown dependency, or a cycle (use at architecture review).
source "$(dirname "$0")/lib/common.sh"
strict=0; max=3
while [ $# -gt 0 ]; do case "$1" in
  --strict) strict=1; shift ;;
  --max) [[ "${2:-}" =~ ^[1-9][0-9]*$ ]] || die "--max needs a positive integer"; max="$2"; shift 2 ;;
  *) break ;; esac; done
[ $# -ge 1 ] && [ $# -le 2 ] || die "usage: dag-ready.sh [--strict] [--max N] <architecture.json> [done.txt]"
arch="$1"; donef="${2:-}"
require_json_file "$arch"
done_json=$( { [ -n "$donef" ] && [ -f "$donef" ] && grep -v '^[[:space:]]*$' "$donef"; } | jq -R . | jq -s .)

if [ "$strict" -eq 1 ]; then
  problems=$(jq -r '
    (.microtasks | map(.task_id)) as $ids |
    ( .microtasks[] | .task_id as $t | .dependencies[] | . as $d | select(($ids | index($d)) == null) | "unknown dependency \($d) in \($t)" ),
    ( [ .microtasks[] | {id:.task_id, deps:.dependencies, files:(.allowed_files + .expected_outputs)} ] as $all |
      def waves($done):
        ([ $all[] | select(([.id] | inside($done)) | not) ]) as $left |
        if ($left|length)==0 then empty else
          ([ $left[] | select(.deps | all(. as $d | $done | index($d) != null)) ]) as $w |
          if ($w|length)==0 then "cycle or unsatisfiable dependencies among: \([$left[].id] | join(", "))"
          else
            ( [ $w[] as $a | $w[] as $b | select($a.id < $b.id) | ($a.files - ($a.files - $b.files))[] as $f |
                "same-wave file overlap: \($f) in \($a.id) and \($b.id)" ] | .[] ),
            waves($done + [$w[].id])
          end
        end;
      if any(.microtasks[]; .dependencies | any(. as $d | ($ids | index($d)) == null)) then empty else waves([]) end )
  ' "$arch") || die "could not evaluate DAG: $arch"
  if [ -n "$problems" ]; then echo "orcs-harness: DAG INVALID ($arch):" >&2; printf '%s\n' "$problems" | sed 's/^/  - /' >&2; exit 1; fi
  echo "OK: DAG valid — $(jq '.microtasks|length' "$arch") micro-tasks, parallel waves file-disjoint"
  exit 0
fi

plan=$(jq -c --argjson done "$done_json" --argjson max "$max" '
  [ .microtasks[] | select((.task_id as $t | $done | index($t)) == null)
                  | select(.dependencies | all(. as $d | $done | index($d) != null)) ] as $ready |
  reduce $ready[] as $t ({batch:[], files:[], deferred:[]};
    ($t.allowed_files + $t.expected_outputs) as $f |
    if (.batch|length) >= $max then .deferred += ["\($t.task_id) (concurrency cap \($max))"]
    elif ([ $f[] as $x | .files[] | select(. == $x) ] | length) > 0
      then .deferred += ["\($t.task_id) (shares files with this batch — serialized)"]
    else .batch += [$t.task_id] | .files += $f end)
' "$arch") || die "could not evaluate DAG: $arch"
jq -r '.deferred[]' <<<"$plan" | sed 's/^/orcs-harness: DEFERRED /' >&2
jq -r '.batch[]' <<<"$plan"
