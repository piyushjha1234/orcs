# executions/ — per-run harness state

In a project that uses Orcs, `init-run.sh <task-id>` creates `executions/<task-id>/`.
Commit it: it is the traceable, resumable record of the run.

| File | Written by | Purpose |
|---|---|---|
| `ACTIVE` (in `executions/`) | `init-run.sh` | id of the run in progress; the stage hook reads it |
| `requirement.json` / `.approved.json` | analyst / `approve.sh` | requirement contract; approved copy is frozen |
| `architecture.json` / `.approved.json` | architect / `approve.sh` | design + micro-task DAG |
| `DEV-n.implementation.json` | developer | what one micro-task changed |
| `DEV-n.audit.json` | scope auditor | behaviour → BR-ID mapping verdict |
| `harness.conf` | orchestrator | `LINT_CMD`, `UNIT_TEST_CMD`, `INTEGRATION_TEST_CMD` |
| `integration.json` | `integration.sh` | merged micro-tasks, runs, `overall_status` |
| `done.txt` | `integration.sh` | merged micro-task ids (input to `dag-ready.sh`) |
| `test-report.json` / `.approved.json` | tester / `approve.sh` | results, scenarios, traceability |
| `approvals.log` | `approve.sh` | who approved which contract, when |
| `budgets.json` | `init-run.sh`, `budgets.sh` | limits and counters |
| `execution-trace.json` | `init-run.sh`, `trace.sh` | `started_at` + deterministic events, incl. owner waits |
| `target.json` | `init-run.sh` | score to beat, best so far, last run's weakest factor |
| `score.json` | `score.sh` | the run's reward score, every factor and input |

This directory in the Orcs repo itself holds only this README.
