#!/usr/bin/env bash
# dev-worktree.sh <task-id> <DEV-n> <integration-branch>   (run from the project root)
# Prepares one developer's isolated workspace: git worktree .orcs-wt/<DEV-n> on branch
# orcs/<task-id>/<DEV-n> (created from the integration branch, reused on re-dispatch),
# a .orcs link to the kit inside it, .orcs + .orcs-wt/ excluded from git, and <DEV-n>
# recorded in executions/<task-id>/inflight.txt. Prints the absolute paths to put in the
# developer's dispatch prompt: WORKTREE, BRANCH, RUN, KIT.
source "$(dirname "$0")/lib/common.sh"
require_cmd git
[ $# -eq 3 ] || die "usage: dev-worktree.sh <task-id> <DEV-n> <integration-branch>"
id="$1"; dev="$2"; ib="$3"
[[ "$dev" =~ ^DEV-[0-9]+$ ]] || die "micro-task id must look like DEV-n, got: '$dev'"
root=$(pwd -P); run="$root/executions/$id"
[ -d "$run" ] || die "no run $id at $run (run init-run.sh first)"
kit="$(cd "$(dirname "$0")/.." && pwd -P)"
excl="$(git rev-parse --git-common-dir)/info/exclude"; mkdir -p "$(dirname "$excl")"
for p in .orcs .orcs-wt/; do grep -qxF "$p" "$excl" 2>/dev/null || echo "$p" >> "$excl"; done
br="orcs/$id/$dev"; wt="$root/.orcs-wt/$dev"
if [ ! -d "$wt" ]; then
  if git show-ref --verify -q "refs/heads/$br"; then git worktree add -q "$wt" "$br" >/dev/null 2>&1
  else git worktree add -q -b "$br" "$wt" "$ib" >/dev/null 2>&1; fi || die "could not create worktree $wt for $br from $ib"
fi
[ -e "$wt/.orcs" ] || ln -s "$kit" "$wt/.orcs"
grep -qx "$dev" "$run/inflight.txt" 2>/dev/null || echo "$dev" >> "$run/inflight.txt"
printf 'WORKTREE=%s\nBRANCH=%s\nRUN=%s\nKIT=%s\n' "$wt" "$br" "$run" "$kit"
