# Token efficiency — owner playbook

For the person running Orcs. No agent loads this file; the rules agents follow are in
`skills/orcs-harness/skill.md` (token discipline) and `references/orchestrator.md`.

## How Orcs spends tokens

- **Each subagent starts cold.** The analyst, architect, every developer, every scope audit,
  every tester shard and the observer each reload the core skill, their contract and the
  knowledge files. Every re-dispatch costs a whole new agent.
- **The main session grows.** Handbacks, gate output and owner Q&A pile up in the
  orchestrator's context and are re-read (as cache) on every turn.
- **Claude Code handles prompt caching itself.** Generic advice about placing cache
  breakpoints, choosing a 5-minute or 1-hour TTL, or turning caching off is for the raw API —
  it does not apply here. A high cache-read share is the goal: `score.sh` counts cache reads
  at `CACHE_READ_WEIGHT` (0.1), the same ratio as their real price.

## What you can do, in order of payoff

1. **Answer every clarifying question fully, in one go.** Each extra analyst or architect
   round is a cold agent. Partial answers cause the most rework.
2. **Approve or flag clearly at each gate.** A vague flag produces a second re-dispatch.
3. **Keep scope to what you need.** Every approved BR-ID adds micro-tasks, audits and
   tests. Put "nice to have" items in `out_of_scope` and plan them as a later run.
4. **Let low-complexity work take the fast-path** (one developer, no fan-out).
5. **One run per session.** `/clear` between unrelated runs. `/compact` when the
   orchestrator suggests it (after architecture approval, after integration PASS).
6. **Don't edit CLAUDE.md, skills or settings during a run.** It invalidates the cached
   prefix and gives agents different rules mid-run.
7. **Watch the token checkpoint.** `token-check.sh` warns at `token_warn_pct` (80 %) and
   stops at `token_stop_pct` (150 %) of `REF_TOKENS_PER_BR × approved BR-IDs`. At a stop,
   decide: continue (raise `token_stop_pct` in `budgets.json`) or cut scope.

## Parallelism and cost

- **Developers** (`concurrent_developers`, default 10): one agent per micro-task whatever
  the cap, so a higher cap costs no extra tokens — it only lets independent tasks run
  together. The DAG's width and file-disjointness set the real parallelism; integration is
  serial. `max_tasks_per_br` (2) stops the architect from splitting work just to fill slots.
- **Testers** (`max_testers` 10, `min_brs_per_tester` 3): every shard is another cold agent,
  so shards scale with the number of approved BR-IDs — 2 BR-IDs get 1 tester, 9 get 3, 30+
  get 10. Lower `max_testers` in `budgets.json` to trade speed for tokens.

## Measuring a change

Compare `score.sh` across runs: the `tokens` factor and `tokens.sh` effective tokens should
improve while `correctness` and the BR pass rate stay the same. Correctness carries
`W_CORRECTNESS` 35 against `W_TOKENS` 10, and any failing BR-ID caps the score at
`QUALITY_CAP`, so a saving that costs correctness always shows up as a lower score.
