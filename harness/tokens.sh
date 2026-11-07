#!/usr/bin/env bash
# tokens.sh <project-dir> <start-iso> <end-iso>
# Measured token usage for one Orcs run, from Claude Code's own transcripts — never
# self-reported. Reads <root>/<slug>/*.jsonl (sessions) and <root>/<slug>/*/subagents/*.jsonl
# (subagents), where root = $ORCS_TRANSCRIPTS_ROOT or ~/.claude/projects and slug = the
# project path with every non-alphanumeric character replaced by "-". Counts assistant
# messages inside [start, end], once per message id (a streamed message is logged once per
# content block). Prints {input, output, cache_creation, cache_read, effective, messages};
# effective = input + output + cache_creation + CACHE_READ_WEIGHT x cache_read.
# Unparseable lines (e.g. a transcript being written) are skipped and reported as
# skipped_lines, never allowed to hide the lines after them.
# Note: every session in the same project directory during the window is counted.
HD="$(cd "$(dirname "$0")" && pwd)"
source "$HD/lib/common.sh"
set -o pipefail
[ $# -eq 3 ] || die "usage: tokens.sh <project-dir> <start-iso> <end-iso>"
proj="$1"; start="$2"; end="$3"
for t in "$start" "$end"; do [[ "$t" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$ ]] || die "timestamps must be ISO-8601 UTC (e.g. 2026-11-07T10:00:00Z), got: $t"; done
load_scoring_conf "${ORCS_SCORING_CONF:-$HD/../knowledge/scoring.conf}"
slug=$(printf '%s' "$proj" | sed 's/[^A-Za-z0-9]/-/g')
dir="${ORCS_TRANSCRIPTS_ROOT:-$HOME/.claude/projects}/$slug"
files=()
for f in "$dir"/*.jsonl "$dir"/*/subagents/*.jsonl; do [ -f "$f" ] && files+=("$f"); done
[ ${#files[@]} -gt 0 ] || die "no transcripts for $proj under $dir — cannot measure tokens"
awk 1 "${files[@]}" | jq -cR '(fromjson? // {skip: true})
    | if .skip == true then {skip: true}
      elif (.message.usage? and .timestamp? and .message.id?) then
        (try {id: .message.id, ts: (.timestamp | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601), u: .message.usage} catch {skip: true})
      else empty end' \
  | jq -s --arg s "$start" --arg e "$end" --argjson w "$CACHE_READ_WEIGHT" '
      ($s | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) as $a | ($e | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) as $b |
      ([ .[] | select(.skip == true) ] | length) as $skipped |
      [ .[] | select(.skip != true and .ts >= $a and .ts <= $b) ] | unique_by(.id) |
      { input:          (map(.u.input_tokens // 0) | add // 0),
        output:         (map(.u.output_tokens // 0) | add // 0),
        cache_creation: (map(.u.cache_creation_input_tokens // 0) | add // 0),
        cache_read:     (map(.u.cache_read_input_tokens // 0) | add // 0),
        messages:       length, skipped_lines: $skipped } |
      .effective = ((.input + .output + .cache_creation + $w * .cache_read) | floor)' \
  || die "could not parse transcripts under $dir"
