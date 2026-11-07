#!/usr/bin/env bash
# upskill-apply.sh <observer-report.md> <file...>   (run from the Orcs source repo root)
# Per-project upskill gate. Stages Orcs asset changes ONLY when the latest project section
# of the observer report carries a real owner approval line under "### Owner Approval":
#   APPROVED: 1, 3        (or)        APPROVED: none
# The template's HTML placeholder comment does not count. Only Orcs's own assets may be
# staged: agents/ knowledge/ contracts/ harness/ skills/orcs-harness/. Commit is left to
# the owner (or the orchestrator on the owner's say-so) — nothing is pushed.
source "$(dirname "$0")/lib/common.sh"
require_cmd git
[ $# -ge 1 ] || die "usage: upskill-apply.sh <observer-report.md> <file...>"
report="$1"; shift
[ -r "$report" ] || die "cannot read observer report: $report"
grep -q '^### User Feedback' "$report" || die "report has no '### User Feedback' section"

approval=$(awk '
  /^## Project / { sect=""; inapp=0 }
  /^### Owner Approval/ { inapp=1; sect=""; next }
  /^### / { inapp=0 }
  inapp { sect = sect $0 "\n" }
  END { printf "%s", sect }' "$report" | perl -0pe 's/<!--.*?-->//gs' | grep -E '^[[:space:]]*APPROVED:' | tail -1)
[ -n "$approval" ] || die "no owner approval in the latest '### Owner Approval' section of $report — owner must write 'APPROVED: <numbers>' or 'APPROVED: none'"

grep -qE '^[[:space:]]*APPROVED:[[:space:]]*(none|[0-9]+([[:space:]]*,[[:space:]]*[0-9]+)*)[[:space:]]*$' <<<"$approval" \
  || die "malformed approval line '$approval' — write exactly 'APPROVED: 1, 3' or 'APPROVED: none'"
if grep -qE 'APPROVED:[[:space:]]*none[[:space:]]*$' <<<"$approval"; then
  [ $# -eq 0 ] || die "owner wrote APPROVED: none — refusing to stage: $*"
  echo "OK: owner approved no changes for this project (recorded in $report)"; exit 0
fi
[ $# -ge 1 ] || die "owner approved changes ($approval) but no files were given"
nums=$(sed -E 's/^[[:space:]]*APPROVED:[[:space:]]*//; s/[[:space:]]//g' <<<"$approval" | tr ',' '\n')
# Proposed-changes rows of the latest project section: | n | file | change | evidence | effect |
rows=$(awk '/^## Project /{buf=""} {buf=buf $0 "\n"} END{printf "%s", buf}' "$report" \
  | awk -F'|' 'NF>=4 { n=$2; f=$3; gsub(/[[:space:]`]/,"",n); gsub(/^[[:space:]`]+|[[:space:]`]+$/,"",f); if (n ~ /^[0-9]+$/) print n "\t" f }')
allowed=""
for n in $nums; do
  f=$(awk -F'\t' -v n="$n" '$1==n {print $2}' <<<"$rows")
  [ -n "$f" ] || die "approved number has no proposal row: no proposal $n in the latest Proposed changes table"
  allowed="$allowed$f"$'\n'
done
for f in "$@"; do
  case "/$f/" in */../*|*/./*) die "path with .. or . segments refused: $f" ;; esac
  grep -qxF -- "$f" <<<"$allowed" || die "$f is not in approved proposals ($approval)"
  case "$f" in
    agents/*|knowledge/*|contracts/*|harness/*|skills/orcs-harness/*) ;;
    *) die "not an Orcs asset (allowed: agents/ knowledge/ contracts/ harness/ skills/orcs-harness/): $f" ;;
  esac
  [ -e "$f" ] || die "file not found: $f"
done
git add -- "$@" || die "git add failed"
echo "STAGED for owner commit ($approval): $*"
