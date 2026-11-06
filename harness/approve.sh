#!/usr/bin/env bash
# approve.sh <task-dir> <kind> <contract.json> <approver>
# Records the owner's contract-review approval (spec §5.9): validates the contract, freezes
# it as <task-dir>/<kind>.approved.json, and appends to <task-dir>/approvals.log.
# Run by the orchestrator ONLY after the owner explicitly approves the contract.
source "$(dirname "$0")/lib/common.sh"
[ $# -eq 4 ] || die "usage: approve.sh <task-dir> <kind> <contract.json> <approver>"
dir="$1"; kind="$2"; file="$3"; who="$4"
[ -d "$dir" ] || die "task dir not found: $dir"
bash "$(dirname "$0")/validate-contract.sh" "$kind" "$file" >/dev/null || exit 1
cp "$file" "$dir/$kind.approved.json"
printf '%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$kind" "$who" "$(basename "$file")" >> "$dir/approvals.log"
echo "APPROVED: $kind frozen at $dir/$kind.approved.json (by $who)"
