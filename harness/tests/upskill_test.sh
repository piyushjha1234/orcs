#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
U="$H/upskill-apply.sh"
R=$(mktemp -d); trap 'rm -rf "$R"' EXIT
git -C "$R" init -q -b main; git -C "$R" config user.email t@t; git -C "$R" config user.name t
mkdir -p "$R/agents" "$R/docs" "$R/src"; echo a > "$R/agents/developer.md"; echo s > "$R/src/app.py"
git -C "$R" add -A; git -C "$R" commit -qm base
echo "b" >> "$R/agents/developer.md"; echo "t" >> "$R/src/app.py"
report() { # report <approval-body>
cat > "$R/docs/07-observer-report.md" <<MD
## Project ORCS-001 — 2026-11-07
### Proposed changes
| 1 | agents/developer.md | add rule | rework x3 | fewer reworks |
| 2 | knowledge/TESTING_GUIDELINES.md | add case | missed edge | coverage |
### User Feedback
Looks right.
### Owner Approval
<!-- Owner: write \`APPROVED: <numbers>\` (or \`APPROVED: none\`) to release the change set. -->
$1
MD
}
up() { (cd "$R" && bash "$U" docs/07-observer-report.md "$@"); }
staged() { git -C "$R" diff --cached --name-only | grep -qx "$1"; }

report ""
assert_fail "placeholder comment is not approval" "no owner approval" up agents/developer.md
assert_pass "nothing staged without approval"     bash -c "! git -C '$R' diff --cached --name-only | grep -q ."
report "APPROVED: none"
assert_fail "APPROVED none refuses files"         "APPROVED: none" up agents/developer.md
report "APPROVED: 1"
assert_fail "file outside Orcs assets refused"    "src/app.py" up src/app.py
assert_pass "approved asset staged"               up agents/developer.md
assert_pass "asset is in the index"               staged agents/developer.md
rm "$R/docs/07-observer-report.md"
assert_fail "missing report refused"              "cannot read" up agents/developer.md
mkdir -p "$R/knowledge"; echo k > "$R/knowledge/TESTING_GUIDELINES.md"
for bad in "APPROVED:" "APPROVED: none." "APPROVED: None — nothing" "APPROVED: no" "APPROVED: <numbers>" "APPROVED: 1, x"; do
  report "$bad"; assert_fail "rejects malformed '$bad'" "malformed" up agents/developer.md
done
report "APPROVED: 1"
assert_fail "file of an unapproved proposal refused" "not in approved proposals" up knowledge/TESTING_GUIDELINES.md
report "APPROVED: 1, 2"
assert_pass "files of approved proposals staged"  up agents/developer.md knowledge/TESTING_GUIDELINES.md
report "APPROVED: 3"
assert_fail "approved number with no table row"   "no proposal 3" up agents/developer.md
report "APPROVED: 1"
assert_fail "dot-dot path refused"                ".." up agents/../docs/07-observer-report.md
finish
