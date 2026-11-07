#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
G="$H/scope-gate.sh"; MT="$FX/microtask/valid.json"   # allowed: src/segment.py; outputs: tests/test_segment.py
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

printf 'src/segment.py\n' > "$T/in-scope"
printf 'src/segment.py\ntests/test_segment.py\n' > "$T/with-output"
printf 'src/segment.py\nsrc/billing.py\n' > "$T/out-of-scope"
: > "$T/empty"

assert_pass "allowed file only"           bash "$G" "$MT" "$T/in-scope"
assert_pass "declared expected_output"    bash "$G" "$MT" "$T/with-output"
assert_pass "no changes"                  bash "$G" "$MT" "$T/empty"
assert_fail "file outside allowed_files"  "src/billing.py" bash "$G" "$MT" "$T/out-of-scope"
assert_fail "missing changed list"        "cannot read"    bash "$G" "$MT" "$T/nope"
assert_fail "invalid microtask"           "allowed_files"  bash "$G" "$FX/microtask/invalid-missing-allowed-files.json" "$T/in-scope"
finish
