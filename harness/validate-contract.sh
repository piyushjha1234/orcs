#!/usr/bin/env bash
# validate-contract.sh [--approved <requirement.approved.json>] <kind> <file.json>
# Deterministic contract check (jq). Enforces the fields/enums the gates depend on.
# With --approved (architecture, test-report): every approved BR-ID must be covered and no
# other BR-ID may appear — under-delivery and invented scope both fail.
# JSON Schema files in contracts/ are the documented source; this is the runtime gate.
source "$(dirname "$0")/lib/common.sh"
approved=""
if [ "${1:-}" = "--approved" ]; then [ -r "${2:-}" ] || die "cannot read approved requirement: ${2:-}"; approved="$2"; shift 2; fi
[ $# -eq 2 ] || die "usage: validate-contract.sh [--approved <requirement.approved.json>] <kind> <file.json>"
kind="$1"; file="$2"
require_json_file "$file"
[ -n "$approved" ] && require_json_file "$approved"

read -r -d '' DEFS <<'JQ'
def req($ks): $ks[] as $k | if has($k) then empty else "missing field: \($k)" end;
def enum($k; $vals): (.[$k]) as $v | if any($vals[]; . == $v) then empty else "invalid \($k): \($v|tojson) (allowed: \($vals|join(", ")))" end;
def brid: test("^BR-[0-9]+$");
def mt_errors($p):
  (req(["task_id","parent_task","objective","requirements","dependencies","allowed_files","expected_outputs","acceptance_criteria","constraints","complexity","budget","status"]) | "\($p)\(.)"),
  (if has("requirements") then (.requirements[] | select(brid|not) | "\($p)invalid BR-ID: \(.)") else empty end),
  (if has("acceptance_criteria") and (.acceptance_criteria|length)==0 then "\($p)acceptance_criteria must not be empty" else empty end),
  (if has("complexity") then (enum("complexity"; ["low","medium","high"]) | "\($p)\(.)") else empty end),
  (if has("status") then (enum("status"; ["pending","in_progress","done","blocked"]) | "\($p)\(.)") else empty end),
  (if has("budget") and ((.budget.max_iterations|type)!="number" or .budget.max_iterations<1) then "\($p)budget.max_iterations must be >= 1" else empty end);
JQ

case "$kind" in
  requirement) PROG='
    req(["task_id","objective","requirements","assumptions","open_questions","out_of_scope","complexity"]),
    (if has("complexity") then enum("complexity"; ["low","medium","high"]) else empty end),
    (if has("requirements") then
      (if (.requirements|length)==0 then "requirements must not be empty" else empty end),
      (.requirements[] | (req(["id","description","priority","acceptance_criteria"]) | "requirement: \(.)"),
         (if has("id") and (.id|brid|not) then "invalid BR-ID: \(.id)" else empty end),
         (if has("priority") then enum("priority"; ["must","should","could"]) else empty end),
         (if has("acceptance_criteria") and (.acceptance_criteria|length)==0 then "acceptance_criteria empty for \(.id)" else empty end)),
      ([.requirements[].id] | group_by(.)[] | select(length>1) | "duplicate BR-ID: \(.[0])")
    else empty end)' ;;
  microtask) PROG='mt_errors("")' ;;
  architecture) PROG='
    req(["task_id","approach","components","requirement_mapping","new_dependencies","alternatives_considered","implementation_steps","open_questions","microtasks"]),
    (if has("new_dependencies") then (.new_dependencies[] | select((.justification // "")=="") | "new dependency lacks justification: \(.name)") else empty end),
    (if has("microtasks") then
      (if (.microtasks|length)==0 then "microtasks must not be empty" else empty end),
      ([.microtasks[].task_id] | group_by(.)[] | select(length>1) | "duplicate micro-task id: \(.[0])"),
      (.microtasks | to_entries[] | .key as $i | .value | mt_errors("microtasks[\($i)]: "))
    else empty end)' ;;
  implementation) PROG='
    req(["task_id","files_changed","requirements_implemented","dependencies_added","known_limitations","blocker"]),
    (if has("requirements_implemented") then (.requirements_implemented[] | select(brid|not) | "invalid BR-ID: \(.)") else empty end),
    (if has("blocker") and ((.blocker|type)!="null" and (.blocker|type)!="string") then "blocker must be string or null" else empty end)' ;;
  test-report) PROG='
    req(["task_id","results","scenarios","traceability","flaws","overall_status"]),
    (if has("overall_status") then enum("overall_status"; ["PASS","FAIL"]) else empty end),
    (if has("results") then (.results[] | (if (.status=="PASS" or .status=="FAIL") then empty else "invalid result status for \(.requirement_id)" end)) else empty end),
    (if .overall_status=="PASS" and any(.results[]?; .status=="FAIL") then "overall_status PASS but a result is FAIL" else empty end),
    (if has("scenarios") and has("traceability") then
      (.traceability) as $t |
      (.scenarios[] | . as $s | if ($t[$s.requirement_id] // [] | index($s.id)) then empty
         else "traceability: scenario \($s.id) not traced to an approved BR-ID (\($s.requirement_id))" end)
    else empty end)' ;;
  execution-trace) PROG='
    req(["task_id","events"]),
    (if has("events") then (.events[] | (.field) as $f | if any(["stage_start","stage_end","iteration","rework_cycle","scope_violation","blocker","test_pass","test_fail","escalation","audit_verdict","owner_wait_start","owner_wait_end","budget_breach"][]; . == $f) then empty else "invalid event field: \($f)" end) else empty end)' ;;
  *) die "unknown kind: $kind (requirement|architecture|microtask|implementation|test-report|execution-trace)" ;;
esac

COVER='empty'
if [ -n "$approved" ]; then
  case "$kind" in
    architecture) COVER='
      . as $c | ($ap[0].requirements | map(.id)) as $ok |
      ([$c.requirement_mapping | keys[]]) as $mapped |
      ([$c.microtasks[]?.requirements[]?] | unique) as $built |
      (($mapped + $built | unique)[] | select(. as $b | $ok | index($b) | not) | "\(.) is not an approved BR-ID"),
      ($ok[] | select(. as $b | $mapped | index($b) | not) | "\(.) not covered by requirement_mapping"),
      ($ok[] | select(. as $b | $built | index($b) | not) | "\(.) not covered by any micro-task")' ;;
    test-report) COVER='
      . as $c | ($ap[0].requirements | map(.id)) as $ok |
      ([$c.results[]?.requirement_id] | unique) as $tested |
      (([$c.results[]?.requirement_id] + [$c.scenarios[]?.requirement_id] + [$c.traceability | keys[]] | unique)[]
         | select(. as $b | $ok | index($b) | not) | "\(.) is not an approved BR-ID"),
      ($ok[] | select(. as $b | $tested | index($b) | not) | "\(.) not tested (no result)"),
      ($ok[] | select(. as $b | ($c.traceability[$b] // []) | length == 0) | "\(.) not traced to any test case")' ;;
    *) die "--approved applies only to architecture and test-report" ;;
  esac
  errors=$(jq -r --slurpfile ap "$approved" "$DEFS ($PROG), ($COVER)" "$file") || die "validator error on $file"
else
  errors=$(jq -r "$DEFS $PROG" "$file") || die "validator error on $file"
fi
if [ -n "$errors" ]; then
  echo "orcs-harness: $kind contract INVALID ($file):" >&2
  printf '%s\n' "$errors" | sed 's/^/  - /' >&2
  exit 1
fi
echo "OK: $kind contract valid ($file)"
