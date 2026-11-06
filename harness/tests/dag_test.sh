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
finish
