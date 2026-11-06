#!/usr/bin/env bash
# Shared helpers for Orcs harness scripts. Exit 0 = pass, non-zero = fail.
die() { echo "orcs-harness: $*" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }
require_json_file() { # require_json_file <path>
  [ -r "$1" ] || die "cannot read file: $1"
  jq -e 'type == "object"' "$1" >/dev/null 2>&1 || die "not valid JSON object: $1"
}
require_cmd jq
sha256_of() { # sha256_of <file>
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1; else sha256sum "$1" | cut -d' ' -f1; fi
}
# verify_approved <task-dir> <kind> — the approved file exists and is byte-identical to what
# the owner approved (sha256 in the latest approvals.log entry for that kind).
verify_approved() {
  local f="$1/$2.approved.json" want got
  [ -f "$f" ] || { echo "$2 contract not approved by owner (missing $f)"; return 1; }
  want=$(awk -F'\t' -v k="$2" '$2==k {s=$5} END {print s}' "$1/approvals.log" 2>/dev/null)
  [ -n "$want" ] || { echo "no recorded approval hash for $2 in $1/approvals.log"; return 1; }
  got=$(sha256_of "$f")
  [ "$got" = "$want" ] || { echo "$f changed after the owner approved it (sha256 mismatch) — re-run the review gate and approve.sh"; return 1; }
}
