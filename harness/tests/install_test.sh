#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
[ -f "$ROOT/install.sh" ] || { echo "install_test.sh: skipped (installer not present — installed kit, not the source repo)"; exit 0; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home" "$T/proj/.claude"
echo '{"permissions":{"allow":["Bash(ls:*)"]},"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"echo keep"}]}]}}' > "$T/proj/.claude/settings.json"
inst() { HOME="$T/home" bash "$ROOT/install.sh" --skip-skills --project "$T/proj" >/dev/null 2>&1; }
S="$T/proj/.claude/settings.json"; K="$T/proj/.claude/orcs"
assert_pass "install runs"                     inst
assert_pass "agents installed"                 test -f "$T/proj/.claude/agents/developer.md"
assert_pass "skill installed"                  test -f "$T/proj/.claude/skills/orcs-pipeline/skill.md"
assert_pass "kit harness installed"            test -x "$K/harness/integration.sh"
assert_pass "kit contracts installed"          test -f "$K/contracts/microtask.schema.json"
assert_pass "kit knowledge installed"          test -f "$K/knowledge/TESTING_GUIDELINES.md"
assert_pass "source repo recorded"             grep -qx "$ROOT" "$K/SOURCE_REPO"
assert_pass "hook registered"                  jq -e '[.hooks.PreToolUse[] | select(.matcher=="Agent|Task") | .hooks[].command | test("block-stage-advance.sh")] | any' "$S"
assert_pass "existing hook kept"               jq -e '[.hooks.PreToolUse[] | select(.matcher=="Bash")] | length == 1' "$S"
assert_pass "existing permissions kept"        jq -e '.permissions.allow == ["Bash(ls:*)"]' "$S"
assert_pass "settings backup written"          bash -c "ls '$T/proj/.claude/'settings.json.bak.* >/dev/null"
assert_pass "re-install"                       inst
assert_pass "hook not duplicated"              jq -e '[.hooks.PreToolUse[] | .hooks[].command | select(test("block-stage-advance.sh"))] | length == 1' "$S"
assert_pass "CLAUDE.md block once"             bash -c "[ \$(grep -c 'orcs:global:start' '$T/home/.claude/CLAUDE.md') -eq 1 ]"
assert_pass "installed hook allows non-Orcs"   bash -c "echo '{\"tool_name\":\"Agent\",\"tool_input\":{\"subagent_type\":\"architect\"},\"cwd\":\"$T\"}' | CLAUDE_PROJECT_DIR='$T' bash '$K/harness/hooks/block-stage-advance.sh'"
finish
