#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
A="$H/scope-audit.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
echo '{"task_id":"DEV-1","changes":[{"ref":"src/segment.py:segment()","br_id":"BR-1"}]}' > "$T/clean.json"
echo '{"task_id":"DEV-1","changes":[{"ref":"src/segment.py:segment()","br_id":"BR-1"},{"ref":"src/segment.py:export_pdf()","br_id":null}]}' > "$T/extra.json"
echo '{"task_id":"DEV-1","changes":[{"ref":"src/segment.py:helper()","br_id":""}]}' > "$T/blank.json"
echo '{"task_id":"DEV-1","changes":[{"ref":"x","br_id":"BR-7"}]}' > "$T/unapproved.json"
echo '{"task_id":"DEV-1"}' > "$T/malformed.json"
APPROVED="$FX/requirement/valid.json"   # approves BR-1, BR-2

assert_pass "all changes mapped"         bash "$A" "$T/clean.json" "$APPROVED"
assert_fail "unmapped extra behaviour"   "export_pdf()" bash "$A" "$T/extra.json" "$APPROVED"
assert_fail "blank br_id"                "helper()"     bash "$A" "$T/blank.json" "$APPROVED"
assert_fail "BR-ID not approved"         "BR-7"         bash "$A" "$T/unapproved.json" "$APPROVED"
assert_fail "verdict missing changes"    "changes"      bash "$A" "$T/malformed.json" "$APPROVED"
finish
