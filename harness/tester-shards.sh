#!/usr/bin/env bash
# tester-shards.sh <task-dir> <integration-branch>   (run from the project root, after integration PASS)
# Splits the approved BR-IDs into tester shards — adaptive, so small projects keep one tester:
#   shards = max(1, min(max_testers, floor(approved BRs / min_brs_per_tester)))
# (budgets.json limits.max_testers, default 10; limits.min_brs_per_tester, default 3).
# BR-IDs are dealt in contract order into contiguous, balanced, disjoint shards. Each shard
# gets its own detached worktree of the integration branch (.orcs-wt/TEST-n, recreated each
# call so every shard tests the same commit), a TC-id block (tc_start = (n-1)*1000+1) so ids
# never collide, and a port_offset ((n-1)*10) so parallel products do not fight over ports.
# Writes <task-dir>/tester-shards.json (read by merge-test-reports.sh) and prints one line per
# shard for the dispatch prompt:  TEST-n <worktree> <BR-1,BR-2> tc_start=<k> port_offset=<p>
source "$(dirname "$0")/lib/common.sh"
require_cmd git
[ $# -eq 2 ] || die "usage: tester-shards.sh <task-dir> <integration-branch>"
td="$1"; ib="$2"
msg=$(verify_approved "$td" requirement) || die "$msg"
[ "$(jq -r '.overall_status // ""' "$td/integration.json" 2>/dev/null)" = PASS ] \
  || die "integration has not passed (need $td/integration.json overall_status PASS) — no testers yet"
git show-ref --verify -q "refs/heads/$ib" || die "integration branch must be a local branch: $ib"
maxt=10; minb=3
if [ -f "$td/budgets.json" ]; then
  maxt=$(jq -r '.limits.max_testers // 10' "$td/budgets.json"); minb=$(jq -r '.limits.min_brs_per_tester // 3' "$td/budgets.json")
fi
for v in "$maxt" "$minb"; do [[ "$v" =~ ^[1-9][0-9]*$ ]] || die "max_testers / min_brs_per_tester must be positive integers, got: $v"; done
brs=(); while IFS= read -r b; do [ -n "$b" ] && brs+=("$b"); done < <(jq -r '.requirements[].id' "$td/requirement.approved.json")  # bash 3.2: no mapfile
n=${#brs[@]}; [ "$n" -gt 0 ] || die "approved requirement has no BR-IDs"
s=$((n / minb)); [ "$s" -gt "$maxt" ] && s=$maxt; [ "$s" -lt 1 ] && s=1

root=$(pwd -P); kit="$(cd "$(dirname "$0")/.." && pwd -P)"
excl="$(git rev-parse --git-common-dir)/info/exclude"; mkdir -p "$(dirname "$excl")"
for p in .orcs .orcs-wt/; do grep -qxF "$p" "$excl" 2>/dev/null || echo "$p" >> "$excl"; done
commit=$(git rev-parse "refs/heads/$ib")
shards='[]'
for ((i = 0; i < s; i++)); do
  lo=$((i * n / s)); hi=$(((i + 1) * n / s))
  ids=$(printf '%s\n' "${brs[@]:lo:hi-lo}" | jq -R . | jq -sc .)
  name="TEST-$((i + 1))"; wt="$root/.orcs-wt/$name"
  if [ -e "$wt" ]; then git worktree remove --force "$wt" >/dev/null 2>&1 || rm -rf "$wt"; git worktree prune; fi
  git worktree add -q --detach "$wt" "$commit" >/dev/null 2>&1 || die "could not create tester worktree $wt at $commit"
  [ -e "$wt/.orcs" ] || ln -s "$kit" "$wt/.orcs"
  shards=$(jq -c --arg sh "$name" --arg wt "$wt" --argjson b "$ids" --argjson tc $((i * 1000 + 1)) --argjson po $((i * 10)) \
    '. + [{shard:$sh, worktree:$wt, brs:$b, tc_start:$tc, port_offset:$po}]' <<<"$shards")
done
jq -n --arg c "$commit" --argjson s "$shards" '{integration_commit:$c, shards:$s}' > "$td/tester-shards.json"
jq -r '.shards[] | "\(.shard) \(.worktree) \(.brs | join(",")) tc_start=\(.tc_start) port_offset=\(.port_offset)"' "$td/tester-shards.json"
