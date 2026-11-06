#!/usr/bin/env bash
# Shared helpers for Orcs harness scripts. Exit 0 = pass, non-zero = fail.
die() { echo "orcs-harness: $*" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }
require_json_file() { # require_json_file <path>
  [ -r "$1" ] || die "cannot read file: $1"
  jq -e 'type == "object"' "$1" >/dev/null 2>&1 || die "not valid JSON object: $1"
}
require_cmd jq
