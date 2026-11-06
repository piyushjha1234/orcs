#!/usr/bin/env bash
# complexity-tripwire.sh <microtask.json> <changed-files-count> <deps-added> [iterations-used]
# Fast-path guard: a task labelled complexity "low" that turns out bigger is escalated to
# the full path (exit 1, "ESCALATE"). The label cannot exempt a task from this check.
source "$(dirname "$0")/lib/common.sh"
[ $# -ge 3 ] && [ $# -le 4 ] || die "usage: complexity-tripwire.sh <microtask.json> <changed-count> <deps-added> [iterations-used]"
mt="$1"; files="$2"; deps="$3"; iters="${4:-0}"
for n in "$files" "$deps" "$iters"; do [[ "$n" =~ ^[0-9]+$ ]] || die "counts must be non-negative integers, got: $n"; done
bash "$(dirname "$0")/validate-contract.sh" microtask "$mt" >/dev/null || exit 1
[ "$(jq -r .complexity "$mt")" = "low" ] || { echo "OK: not a fast-path task ($(jq -r .complexity "$mt"))"; exit 0; }
max_files="${ORCS_FASTPATH_MAX_FILES:-3}"; max_iters=$(jq -r '.budget.max_iterations' "$mt")
reasons=()
[ "$files" -gt "$max_files" ] && reasons+=("changed $files files (fast-path max $max_files)")
[ "$deps" -gt 0 ] && reasons+=("added $deps dependency/dependencies")
[ "$iters" -gt "$max_iters" ] && reasons+=("used $iters iterations (budget $max_iters)")
if [ ${#reasons[@]} -gt 0 ]; then
  echo "orcs-harness: ESCALATE $(jq -r .task_id "$mt") to full path — labelled low but:" >&2
  printf '  - %s\n' "${reasons[@]}" >&2
  exit 1
fi
echo "OK: fast-path holds for $(jq -r .task_id "$mt")"
