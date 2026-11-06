#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
TK="$H/tokens.sh"
X=$(mktemp -d); trap 'rm -rf "$X"' EXIT
PROJ="$X/my proj.v2"; mkdir -p "$PROJ"
SLUG=$(printf '%s' "$PROJ" | sed 's/[^A-Za-z0-9]/-/g'); TR="$X/transcripts/$SLUG"; mkdir -p "$TR/sess-1/subagents"
u() { jq -cn --arg id "$1" --arg ts "$2" --argjson i "$3" --argjson o "$4" --argjson cc "$5" --argjson cr "$6" \
  '{type:"assistant", timestamp:$ts, message:{id:$id, usage:{input_tokens:$i, output_tokens:$o, cache_creation_input_tokens:$cc, cache_read_input_tokens:$cr}}}'; }
{ u msg_A 2026-11-07T10:00:00.123Z 10 20 100 1000; u msg_A 2026-11-07T10:00:00.456Z 10 20 100 1000
  u msg_B 2026-11-07T09:00:00.000Z 500 500 500 500; echo '{"type":"user","timestamp":"2026-11-07T10:01:00.000Z","message":{"content":"hi"}}'; } > "$TR/sess-1.jsonl"
u msg_C 2026-11-07T10:30:00.000Z 1 2 0 0 > "$TR/sess-1/subagents/agent-x.jsonl"
run() { ORCS_TRANSCRIPTS_ROOT="$X/transcripts" bash "$TK" "$PROJ" 2026-11-07T09:30:00Z 2026-11-07T11:00:00Z; }
OUT=$(run 2>&1)
assert_pass "tokens run succeeds"            run
assert_pass "duplicate message counted once" jq -e '.messages == 2' <<<"$OUT"
assert_pass "out-of-window excluded"         jq -e '.input == 11 and .output == 22' <<<"$OUT"
assert_pass "subagent transcripts included"  jq -e '.input == 11' <<<"$OUT"
assert_pass "cache fields summed"            jq -e '.cache_creation == 100 and .cache_read == 1000' <<<"$OUT"
assert_pass "effective uses cache weight"    jq -e '.effective == 233' <<<"$OUT"
assert_fail "missing transcripts fail loud"  "no transcripts" env ORCS_TRANSCRIPTS_ROOT="$X/none" bash "$TK" "$PROJ" 2026-11-07T09:30:00Z 2026-11-07T11:00:00Z
assert_fail "bad timestamp refused"          "ISO" env ORCS_TRANSCRIPTS_ROOT="$X/transcripts" bash "$TK" "$PROJ" yesterday 2026-11-07T11:00:00Z
{ u msg_D 2026-11-07T10:40:00.000Z 3 0 0 0; echo '{broken json'; u msg_E 2026-11-07T10:50:00.000Z 4 0 0 0; } > "$TR/sess-2.jsonl"
OUT2=$(run 2>&1)
assert_pass "line after a broken line counted" jq -e '.input == 18' <<<"$OUT2"
assert_pass "broken lines reported"            jq -e '.skipped_lines == 1' <<<"$OUT2"
finish
