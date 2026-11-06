#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
D="$H/dag-ready.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mk() { jq --arg id "$1" --argjson deps "$2" --argjson files "$3" '.task_id=$id | .dependencies=$deps | .allowed_files=$files | .expected_outputs=[]' "$FX/microtask/valid.json"; }
arch() { jq -n --slurpfile b "$FX/architecture/valid.json" '$b[0] | .microtasks = $ARGS.positional' --jsonargs "$@"; }
arch "$(mk DEV-1 '[]' '["src/a.py"]')" "$(mk DEV-2 '[]' '["src/b.py"]')" "$(mk DEV-3 '["DEV-1","DEV-2"]' '["src/c.py"]')" > "$T/ok.json"
arch "$(mk DEV-1 '[]' '["src/a.py"]')" "$(mk DEV-4 '[]' '["src/a.py"]')" > "$T/overlap.json"
arch "$(mk DEV-1 '["DEV-2"]' '["src/a.py"]')" "$(mk DEV-2 '["DEV-1"]' '["src/b.py"]')" > "$T/cycle.json"
arch "$(mk DEV-1 '["DEV-9"]' '["src/a.py"]')" > "$T/unknown.json"
arch "$(mk DEV-1 '[]' '["src/a.py"]')" "$(mk DEV-2 '["DEV-1"]' '["src/a.py"]')" > "$T/seq-share.json"
: > "$T/none"; printf 'DEV-1\nDEV-2\n' > "$T/d12"

assert_pass "wave 1 = DEV-1,DEV-2"        bash -c "[ \"\$(bash '$D' '$T/ok.json' '$T/none' | tr '\n' ' ')\" = 'DEV-1 DEV-2 ' ]"
assert_pass "after 1,2 done → DEV-3"      bash -c "[ \"\$(bash '$D' '$T/ok.json' '$T/d12')\" = 'DEV-3' ]"
assert_pass "overlap auto-serialized"     bash -c "[ \"\$(bash '$D' '$T/overlap.json' '$T/none' 2>/dev/null)\" = 'DEV-1' ]"
assert_fail "strict rejects same-wave overlap" "src/a.py" bash "$D" --strict "$T/overlap.json"
assert_pass "strict accepts valid DAG"    bash "$D" --strict "$T/ok.json"
assert_pass "strict allows sequential file sharing" bash "$D" --strict "$T/seq-share.json"
assert_fail "strict rejects cycle"        "cycle" bash "$D" --strict "$T/cycle.json"
assert_fail "unknown dependency refused"  "DEV-9" bash "$D" --strict "$T/unknown.json"
assert_pass "--max 1 caps the batch"      bash -c "[ \"\$(bash '$D' --max 1 '$T/ok.json' '$T/none')\" = 'DEV-1' ]"
assert_pass "all done → empty batch"      bash -c "printf 'DEV-1\nDEV-2\nDEV-3\n' > '$T/all'; [ -z \"\$(bash '$D' '$T/ok.json' '$T/all')\" ]"
# in-flight: DEV-1(a) DEV-2(b) dispatched; DEV-1 merged; DEV-5(b, after DEV-1) must wait for DEV-2
arch "$(mk DEV-1 '[]' '["src/a.py"]')" "$(mk DEV-2 '[]' '["src/b.py"]')" "$(mk DEV-5 '["DEV-1"]' '["src/b.py"]')" > "$T/inflight.json"
printf 'DEV-1\n' > "$T/d1"; printf 'DEV-2\n' > "$T/if2"
assert_pass "in-flight task not re-offered"      bash -c "! bash '$D' '$T/inflight.json' '$T/d1' '$T/if2' 2>/dev/null | grep -qx DEV-2"
assert_pass "task sharing an in-flight file waits" bash -c "[ -z \"\$(bash '$D' '$T/inflight.json' '$T/d1' '$T/if2' 2>/dev/null)\" ]"
printf 'DEV-1\nDEV-2\n' > "$T/d12b"
assert_pass "runs once the in-flight task is done" bash -c "[ \"\$(bash '$D' '$T/inflight.json' '$T/d12b' /dev/null)\" = DEV-5 ]"
printf 'DEV-1\nDEV-2\n' > "$T/if12"
assert_pass "in-flight tasks count toward --max" bash -c "[ -z \"\$(bash '$D' --max 2 '$T/ok.json' '$T/none' '$T/if12' 2>/dev/null)\" ]"
finish
