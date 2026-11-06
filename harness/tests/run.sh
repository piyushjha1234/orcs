#!/usr/bin/env bash
# Run every harness test file; exit non-zero if any fails.
cd "$(dirname "$0")" || exit 1
rc=0
for t in *_test.sh; do bash "$t" || rc=1; done
[ "$rc" -eq 0 ] && echo "ALL HARNESS TESTS PASSED" || echo "HARNESS TESTS FAILED"
exit "$rc"
