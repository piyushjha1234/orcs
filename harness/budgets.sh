#!/usr/bin/env bash
# budgets.sh [--check] <budgets.json> <counter>
# Increments <counter> (unless --check) and fails if it now exceeds its limit.
# Per-task counters like fix_cycles_DEV-3 use the limit of their prefix (fix_cycles).
# On breach: stop, keep state, report — never retry past a budget.
source "$(dirname "$0")/lib/common.sh"
check=0; [ "${1:-}" = "--check" ] && { check=1; shift; }
[ $# -eq 2 ] || die "usage: budgets.sh [--check] <budgets.json> <counter>"
file="$1"; counter="$2"
require_json_file "$file"
limit=$(jq -r --arg c "$counter" '.limits[$c] // .limits[($c | sub("_DEV-[0-9]+$"; ""))] // empty' "$file")
[ -n "$limit" ] || die "no budget limit defined for counter: $counter"
[[ "$limit" =~ ^[0-9]+$ ]] || die "budget limit for $counter must be an integer, got: $limit"
if [ "$check" -eq 0 ]; then
  tmp=$(mktemp) && jq --arg c "$counter" '.counts[$c] = ((.counts[$c] // 0) + 1)' "$file" > "$tmp" && mv "$tmp" "$file"
fi
count=$(jq -r --arg c "$counter" '.counts[$c] // 0' "$file")
if [ "$count" -gt "$limit" ]; then
  echo "orcs-harness: BUDGET EXCEEDED: $counter = $count (limit $limit). Stop, keep state, report the gap to the owner." >&2
  exit 1
fi
echo "OK: $counter $count/$limit"
