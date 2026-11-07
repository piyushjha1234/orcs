#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
W="$H/dev-worktree.sh"
P=$(cd "$(mktemp -d)" && pwd -P); trap 'rm -rf "$P"' EXIT
git -C "$P" init -q -b main; git -C "$P" config user.email t@t; git -C "$P" config user.name t
echo a > "$P/a.txt"; git -C "$P" add -A; git -C "$P" commit -qm base; git -C "$P" branch orcs/ORCS-001/integration
(cd "$P" && bash "$H/init-run.sh" ORCS-001 >/dev/null)
wt() { (cd "$P" && bash "$W" "$@"); }
OUT=$(wt ORCS-001 DEV-1 orcs/ORCS-001/integration 2>&1)
assert_pass "worktree created"                 test -f "$P/.orcs-wt/DEV-1/a.txt"
assert_pass "on its own branch"                bash -c "[ \"\$(git -C '$P/.orcs-wt/DEV-1' branch --show-current)\" = orcs/ORCS-001/DEV-1 ]"
assert_pass "kit reachable from worktree"      test -x "$P/.orcs-wt/DEV-1/.orcs/harness/validate-contract.sh"
assert_pass "prints absolute RUN path"         grep -qx "RUN=$P/executions/ORCS-001" <<<"$OUT"
assert_pass "prints WORKTREE path"             grep -qx "WORKTREE=$P/.orcs-wt/DEV-1" <<<"$OUT"
assert_pass "recorded in flight"               grep -qx DEV-1 "$P/executions/ORCS-001/inflight.txt"
assert_pass ".orcs never shows as untracked"   bash -c "! git -C '$P/.orcs-wt/DEV-1' status --porcelain | grep -q orcs"
assert_pass "main tree clean of harness dirs"  bash -c "! git -C '$P' status --porcelain | grep -qE '\\.orcs'"
assert_pass "re-dispatch reuses worktree"      wt ORCS-001 DEV-1 orcs/ORCS-001/integration
assert_pass "in-flight not duplicated"         bash -c "[ \$(grep -cx DEV-1 '$P/executions/ORCS-001/inflight.txt') -eq 1 ]"
assert_fail "bad micro-task id refused"        "DEV-n" wt ORCS-001 'x y' orcs/ORCS-001/integration
assert_fail "unknown run refused"              "no run" wt ORCS-404 DEV-1 orcs/ORCS-001/integration
finish
