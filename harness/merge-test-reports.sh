#!/usr/bin/env bash
# merge-test-reports.sh <task-dir>
# Merges the tester shards listed in <task-dir>/tester-shards.json (from tester-shards.sh)
# into <task-dir>/test-report.json, the one contract the owner reviews and approve.sh freezes.
# Refuses (exit 1, nothing written) when: a shard report is missing or invalid; a shard
# reports a BR-ID outside its shard; a TC id is outside its shard's block or used twice;
# or the merged report does not cover every approved BR-ID (validate-contract.sh --approved).
# overall_status is PASS only when every result in every shard is PASS.
HD="$(cd "$(dirname "$0")" && pwd)"
source "$HD/lib/common.sh"
[ $# -eq 1 ] || die "usage: merge-test-reports.sh <task-dir>"
td="$1"; sj="$td/tester-shards.json"
require_json_file "$sj"
msg=$(verify_approved "$td" requirement) || die "$msg"
problems=""; files=()
while IFS= read -r sh; do
  f="$td/test-report.$sh.json"
  if [ ! -f "$f" ]; then problems+="missing shard report $f"$'\n'; continue; fi
  if ! err=$(bash "$HD/validate-contract.sh" test-report "$f" 2>&1); then problems+="$sh: $(tr '\n' ' ' <<<"$err")"$'\n'; continue; fi
  files+=("$f")
  p=$(jq -r --slurpfile s "$sj" --arg sh "$sh" '
    ($s[0].shards[] | select(.shard == $sh)) as $me |
    ( ([.results[].requirement_id] + [.scenarios[].requirement_id] + [.traceability | keys[]] | unique)[]
        | select(. as $b | $me.brs | index($b) | not)
        | "\($sh): reports \(.), which is not in its shard (\($me.brs | join(",")))" ),
    ( .scenarios[].id | (ltrimstr("TC-") | tonumber) as $n
        | select($n < $me.tc_start or $n >= $me.tc_start + 1000)
        | "\($sh): TC-\($n) is outside its id block TC-\($me.tc_start)..TC-\($me.tc_start + 999)" )' "$f") \
    || die "could not read shard report $f"
  [ -n "$p" ] && problems+="$p"$'\n'
done < <(jq -r '.shards[].shard' "$sj")
[ "${#files[@]}" -gt 0 ] || problems+="no shard reports to merge"$'\n'
if [ -z "$problems" ]; then
  dup=$(jq -rs '[.[].scenarios[].id] | group_by(.)[] | select(length > 1) | "duplicate TC id across shards: \(.[0])"' "${files[@]}")
  [ -n "$dup" ] && problems+="$dup"$'\n'
fi
if [ -n "$problems" ]; then
  echo "orcs-harness: TEST SHARD MERGE REFUSED ($td):" >&2
  printf '%s' "$problems" | sed '/^$/d; s/^/  - /' >&2
  exit 1
fi
out="$td/test-report.json"; tmp=$(mktemp)
jq -s --arg t "$(jq -r .task_id "$td/requirement.approved.json")" '
  { task_id: $t,
    results:      [ .[].results[] ],
    scenarios:    [ .[].scenarios[] ],
    traceability: (map(.traceability) | add),
    flaws:        [ .[].flaws[] ],
    overall_status: (if all(.[].results[]; .status == "PASS") then "PASS" else "FAIL" end) }' "${files[@]}" > "$tmp" \
  || { rm -f "$tmp"; die "could not merge shard reports"; }
if ! err=$(bash "$HD/validate-contract.sh" --approved "$td/requirement.approved.json" test-report "$tmp" 2>&1); then
  rm -f "$tmp"; echo "orcs-harness: TEST SHARD MERGE REFUSED ($td): merged report fails coverage:" >&2; echo "$err" >&2; exit 1
fi
mv "$tmp" "$out"
echo "OK: merged ${#files[@]} shard(s) into $out — overall $(jq -r .overall_status "$out"), $(jq '.scenarios | length' "$out") test cases"
