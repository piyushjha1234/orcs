#!/usr/bin/env bash
# scope-audit.sh <verdict.json> <requirements.approved.json>
# Behaviour-level scope gate. The orchestrator runs the independent scope-auditor (see
# scope-auditor/PROMPT.md) on a branch diff; it writes a verdict:
#   {"task_id":"DEV-n","changes":[{"ref":"file:symbol","br_id":"BR-n"|null}]}
# This script fails if any change is unmapped or mapped to a BR-ID that was not approved.
source "$(dirname "$0")/lib/common.sh"
[ $# -eq 2 ] || die "usage: scope-audit.sh <verdict.json> <requirements.approved.json>"
verdict="$1"; approved="$2"
require_json_file "$verdict"; require_json_file "$approved"
jq -e '(.changes|type)=="array"' "$verdict" >/dev/null || die "verdict missing changes[] array: $verdict"

problems=$(jq -r --slurpfile ap "$approved" '
  ($ap[0].requirements | map(.id)) as $ok |
  .changes[] | (.br_id // "") as $b |
  if $b == "" then "UNMAPPED behaviour (no approved BR-ID): \(.ref)"
  elif ($ok | index($b)) == null then "mapped to non-approved \($b): \(.ref)"
  else empty end' "$verdict") || die "auditor verdict could not be evaluated: $verdict"

if [ -n "$problems" ]; then
  echo "orcs-harness: SCOPE AUDIT FAILED for $(jq -r '.task_id // "?"' "$verdict") — reject, re-dispatch developer:" >&2
  printf '%s\n' "$problems" | sed 's/^/  - /' >&2
  exit 1
fi
echo "OK: scope audit passed for $(jq -r '.task_id // "?"' "$verdict") ($(jq '.changes|length' "$verdict") changes mapped)"
