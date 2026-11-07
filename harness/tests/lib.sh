#!/usr/bin/env bash
# Minimal assertion helpers for plain-bash harness tests.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
H="$ROOT/harness"
FX="$ROOT/contracts/fixtures"
PASS=0; FAIL=0

assert_pass() { # assert_pass <name> <cmd...>
  local name="$1"; shift
  if out=$("$@" 2>&1); then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "FAIL: $name — expected exit 0, got non-zero: $out"; fi
}

assert_fail() { # assert_fail <name> <expected-substring|""> <cmd...>
  local name="$1" want="$2"; shift 2
  if out=$("$@" 2>&1); then FAIL=$((FAIL+1)); echo "FAIL: $name — expected non-zero exit, got 0"; return; fi
  if [ -n "$want" ] && ! grep -qF -- "$want" <<<"$out"; then FAIL=$((FAIL+1)); echo "FAIL: $name — missing '$want' in: $out"; return; fi
  PASS=$((PASS+1))
}

finish() { echo "$(basename "$0"): $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]; }
