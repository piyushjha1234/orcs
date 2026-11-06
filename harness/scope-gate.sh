#!/usr/bin/env bash
# scope-gate.sh <microtask.json> <changed-files-list>
# File-level scope gate: every changed path must be in allowed_files ∪ expected_outputs.
# The changed list has one repo-relative path per line (e.g. `git diff --name-only BASE`).
source "$(dirname "$0")/lib/common.sh"
[ $# -eq 2 ] || die "usage: scope-gate.sh <microtask.json> <changed-files-list>"
mt="$1"; changed="$2"
bash "$(dirname "$0")/validate-contract.sh" microtask "$mt" >/dev/null || exit 1
[ -r "$changed" ] || die "cannot read changed-files list: $changed"

owned=$(jq -r '(.allowed_files + .expected_outputs)[]' "$mt")
violations=()
while IFS= read -r path; do
  [ -z "$path" ] && continue
  grep -qxF -- "$path" <<<"$owned" || violations+=("$path")
done < "$changed"

if [ ${#violations[@]} -gt 0 ]; then
  echo "orcs-harness: SCOPE VIOLATION in $(jq -r .task_id "$mt") — files outside allowed_files/expected_outputs:" >&2
  printf '  - %s\n' "${violations[@]}" >&2
  exit 1
fi
echo "OK: scope gate passed for $(jq -r .task_id "$mt")"
