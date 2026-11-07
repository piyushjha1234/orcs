#!/usr/bin/env bash
# approve.sh <task-dir> <kind> <contract.json> <approver>
# Records the owner's contract-review approval (spec §5.9). Validates the contract — for
# architecture and test-report also against the approved requirement (coverage, no
# invented BR-IDs), and for architecture the strict DAG check — then freezes it as
# <task-dir>/<kind>.approved.json and logs approver + sha256 in <task-dir>/approvals.log.
# Run by the orchestrator ONLY after the owner explicitly approves the contract.
HD="$(cd "$(dirname "$0")" && pwd)"
source "$HD/lib/common.sh"
[ $# -eq 4 ] || die "usage: approve.sh <task-dir> <kind> <contract.json> <approver>"
dir="$1"; kind="$2"; file="$3"; who="$4"
[ -d "$dir" ] || die "task dir not found: $dir"
case "$kind" in
  architecture|test-report)
    msg=$(verify_approved "$dir" requirement) || die "cannot approve $kind: $msg"
    bash "$HD/validate-contract.sh" --approved "$dir/requirement.approved.json" "$kind" "$file" >/dev/null || exit 1 ;;
  *) bash "$HD/validate-contract.sh" "$kind" "$file" >/dev/null || exit 1 ;;
esac
if [ "$kind" = architecture ]; then
  per_br=$(jq -r '.limits.max_tasks_per_br // 2' "$dir/budgets.json" 2>/dev/null || echo 2)
  [[ "$per_br" =~ ^[1-9][0-9]*$ ]] || die "budgets.json limits.max_tasks_per_br must be a positive integer, got: $per_br"
  bash "$HD/dag-ready.sh" --strict --max-tasks-per-br "$per_br" "$file" >/dev/null || exit 1
fi
cp "$file" "$dir/$kind.approved.json"
printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$kind" "$who" "$(basename "$file")" "$(sha256_of "$dir/$kind.approved.json")" >> "$dir/approvals.log"
echo "APPROVED: $kind frozen at $dir/$kind.approved.json (by $who)"
