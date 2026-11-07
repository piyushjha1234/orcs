#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
P="$H/precheck.sh"; AP="$H/approve.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
R="$T/repo"; TD="$R/executions/ORCS-001"; B=orcs/ORCS-001/DEV-1; IB=orcs/ORCS-001/integration; W="$T/wt"
g() { git -C "$R" "$@" >/dev/null 2>&1; }
setup() {
  rm -rf "$R" "$W"; mkdir -p "$R/src" && git -C "$R" init -q -b main && git -C "$R" config user.email t@t && git -C "$R" config user.name t
  echo "def segment(): pass" > "$R/src/segment.py"; echo "x=1" > "$R/src/billing.py"; g add -A; g commit -qm base
  g branch "$IB"; echo "executions/" >> "$R/.git/info/exclude"
  mkdir -p "$TD"; bash "$AP" "$TD" requirement "$FX/requirement/valid.json" owner >/dev/null
  bash "$AP" "$TD" architecture "$FX/architecture/valid.json" owner >/dev/null || echo "SETUP: architecture approval failed"
  printf 'LINT_CMD="grep -q def src/segment.py"\nUNIT_TEST_CMD="test -f src/segment.py"\nINTEGRATION_TEST_CMD=none\n' > "$TD/harness.conf"
  echo '{"task_id":"ORCS-001","events":[]}' > "$TD/execution-trace.json"
  g worktree add -q -b "$B" "$W" "$IB"
}
dev() { # dev <file> <content> — commit one change in the developer worktree
  mkdir -p "$(dirname "$W/$1")"; echo "$2" > "$W/$1"; git -C "$W" add -A >/dev/null; git -C "$W" commit -qm dev >/dev/null
}
run() { (cd "$R" && bash "$P" executions/ORCS-001 DEV-1 "$B" "$IB" "$W"); }

setup; dev src/segment.py "def segment(): return 'inactive'"
assert_pass "clean in-scope branch passes"        run
assert_pass "no excerpt on pass"                  test ! -e "$TD/DEV-1.failure.txt"
assert_pass "integration.json untouched"          test ! -e "$TD/integration.json"

setup; dev src/billing.py "x=2"
assert_fail "out-of-scope file stops before audit" "REDISPATCH DEV-1: precheck scope gate" run
assert_pass "scope violation traced"              jq -e 'any(.events[]; .field=="scope_violation")' "$TD/execution-trace.json"
assert_pass "excerpt written"                     grep -q "FAILED: precheck: scope gate" "$TD/DEV-1.failure.txt"

setup; dev src/segment.py "segment = 1"
assert_fail "lint failure stops before audit"     "precheck lint failed" run
assert_pass "rework traced"                       jq -e 'any(.events[]; .field=="rework_cycle")' "$TD/execution-trace.json"
assert_pass "excerpt holds the lint step"         grep -q "^== lint" "$TD/DEV-1.failure.txt"

setup; dev src/segment.py "def segment(): return 'inactive'"; echo "def segment(): return 'x'" > "$W/src/segment.py"
assert_fail "uncommitted change refused"          "uncommitted" run

setup; dev src/segment.py "def segment(): return 'inactive'"; git -C "$W" checkout -q --detach HEAD~1
assert_fail "worktree off branch head refused"    "not at the head" run

setup; dev src/segment.py "def segment(): return 'inactive'"; jq '.microtasks[0].allowed_files += ["src/billing.py"]' "$TD/architecture.approved.json" > "$T/x" && mv "$T/x" "$TD/architecture.approved.json"
assert_fail "edited approved contract refused"    "changed after" run
finish
