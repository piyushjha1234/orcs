#!/usr/bin/env bash
# trace.sh <task-id> <field> <value> [stage]   (run from the project root)
# Appends one deterministic event to executions/<task-id>/execution-trace.json.
# Fields: stage_start stage_end iteration rework_cycle scope_violation blocker
#         test_pass test_fail escalation audit_verdict owner_wait_start owner_wait_end.  Values that parse as JSON are
# stored as JSON (numbers, null, objects); anything else as a string. Token/cost fields
# stay null until a real measurement path exists (Phase 4) — never self-reported.
source "$(dirname "$0")/lib/common.sh"
[ $# -ge 3 ] && [ $# -le 4 ] || die "usage: trace.sh <task-id> <field> <value> [stage]"
id="$1"; field="$2"; value="$3"; stage="${4:-}"
f="executions/$id/execution-trace.json"
[ -f "$f" ] || die "no trace for run $id at $f (run init-run.sh first)"
case "$field" in
  stage_start|stage_end|iteration|rework_cycle|scope_violation|blocker|test_pass|test_fail|escalation|audit_verdict|owner_wait_start|owner_wait_end) ;;
  *) die "invalid event field: $field" ;;
esac
if jq -e . >/dev/null 2>&1 <<<"$value"; then vjson="$value"; else vjson=$(jq -Rn --arg v "$value" '$v'); fi
tmp=$(mktemp)
jq --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg st "$stage" --arg fd "$field" --argjson v "$vjson" \
  '.events += [{ts:$ts, stage:$st, field:$fd, value:$v}]' "$f" > "$tmp" && mv "$tmp" "$f"
echo "OK: traced $field for $id"
