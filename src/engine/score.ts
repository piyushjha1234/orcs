import fs from 'node:fs';
import path from 'node:path';
import type { Architecture, BugReport, Requirement, State, Usage } from '../types.ts';
import * as store from './store.ts';

export const WEIGHTS = { correctness: 35, quality: 20, satisfaction: 20, tokens: 10, speed: 10, completion: 5 };
export const PENALTIES = { scope_violations: 0.1, rework: 0.05, blockers: 0.03 };
export const REFS = { tokens_per_br: 150_000, minutes_per_br: 15 };
export const CAP = 60;

type Factor = keyof typeof WEIGHTS;

export interface ScoreRecord {
  id: string;
  project: string;
  name: string;
  score: number;
  raw: number;
  capped: boolean;
  tested: boolean;
  intensity: string | null;
  factors: Record<Factor, number | null>;
  points: Record<Factor, number | null>;
  brs: number;
  effective: number;
  cost: number;
  minutes: number;
  wait_minutes: number;
  seeded?: boolean;
  scored_at: string;
}

const SEED: ScoreRecord = {
  id: 'orcs-1',
  project: 'sfguide',
  name: 'sfguide (orcs v1)',
  score: 65.3,
  raw: 65.3,
  capped: false,
  tested: true,
  intensity: null,
  factors: { correctness: 1, quality: 0.3, satisfaction: 0.9, tokens: 0.025, speed: 0.102, completion: 1 },
  points: { correctness: 35, quality: 6, satisfaction: 18, tokens: 0.3, speed: 1, completion: 5 },
  brs: 10,
  effective: 60_695_540,
  cost: 0,
  minutes: 1475.9,
  wait_minutes: 18.9,
  seeded: true,
  scored_at: '2026-11-08T04:49:30Z',
};

const file = () => path.join(store.home(), 'scores.jsonl');

export function ensureSeed(): void {
  if (!fs.existsSync(file())) store.appendLine(file(), SEED);
}

export function history(): ScoreRecord[] {
  const last = new Map<string, ScoreRecord>();
  for (const r of store.readLines<ScoreRecord>(file())) last.set(r.id, r);
  return [...last.values()];
}

export interface ScoreInputs {
  brs: number;
  passed: number | null;
  rework: number;
  scope_violations: number;
  blockers: number;
  rating: number;
  effective: number;
  minutes: number;
  planned: number;
  merged: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function computeScore(i: ScoreInputs): Pick<ScoreRecord, 'score' | 'raw' | 'capped' | 'factors' | 'points'> {
  const per = Math.max(i.brs, 1);
  const factors: Record<Factor, number | null> = {
    correctness: i.passed === null ? null : i.passed / per,
    quality: Math.max(0, 1 - (i.scope_violations * PENALTIES.scope_violations + i.rework * PENALTIES.rework + i.blockers * PENALTIES.blockers)),
    satisfaction: i.rating / 10,
    tokens: i.effective <= 0 ? 1 : Math.min(1, REFS.tokens_per_br / (i.effective / per)),
    speed: i.minutes <= 0 ? 1 : Math.min(1, REFS.minutes_per_br / (i.minutes / per)),
    completion: i.planned ? i.merged / i.planned : 1,
  };
  const used = (Object.keys(WEIGHTS) as Factor[]).filter((k) => factors[k] !== null);
  const total = used.reduce((s, k) => s + WEIGHTS[k], 0);
  const points = {} as Record<Factor, number | null>;
  let raw = 0;
  for (const k of Object.keys(WEIGHTS) as Factor[]) {
    const f = factors[k];
    if (f === null) {
      points[k] = null;
      continue;
    }
    const p = (WEIGHTS[k] * f * 100) / total;
    points[k] = r1(p);
    raw += p;
  }
  const capped = factors.correctness !== null && factors.correctness < 1 && raw > CAP;
  for (const k of Object.keys(factors) as Factor[]) if (factors[k] !== null) factors[k] = r3(factors[k]!);
  return { score: r1(capped ? CAP : raw), raw: r1(raw), capped, factors, points };
}

export function waitMinutes(id: string): number {
  const answers = store.answers(id);
  const spans = store.questions(id)
    .map((q) => [Date.parse(q.created_at), Date.parse(answers.get(q.id)?.at ?? '')] as const)
    .filter(([a, b]) => !Number.isNaN(a) && !Number.isNaN(b))
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let end = -Infinity;
  for (const [a, b] of spans) {
    if (b <= end) continue;
    total += b - Math.max(a, end);
    end = b;
  }
  return total / 60_000;
}

export function passedBrs(req: Requirement, report: BugReport | undefined, cases: { id: string; br: string }[]): number {
  if (!report) return 0;
  const failed = new Set<string>();
  for (const r of report.results) if (r.status === 'fail') failed.add(cases.find((c) => c.id === r.case)?.br ?? '');
  for (const b of report.bugs) if (b.status === 'open' && b.risk !== 'low') failed.add(b.br);
  return req.brs.filter((b) => !failed.has(b.id)).length;
}

export function scoreRun(s: State): ScoreRecord {
  const req = store.readJson<Requirement>(store.runFile(s.id, 'requirement.json'));
  const arch = store.readJson<Architecture>(store.runFile(s.id, 'architecture.json'));
  const usage = store.readLines<Usage>(store.runFile(s.id, 'usage.jsonl'));
  const report = store.readJsonIf<BugReport>(store.runFile(s.id, 'bugs.json'));
  const plan = store.readJsonIf<{ cases: { id: string; br: string }[] }>(store.runFile(s.id, 'tests.json'));
  const effective = usage.reduce((n, u) => n + u.effective, 0);
  const cost = usage.reduce((n, u) => n + u.cost, 0);
  const wait = waitMinutes(s.id);
  const wall = (Date.parse(s.ended_at ?? store.now()) - Date.parse(s.created_at)) / 60_000;
  const minutes = Math.max(0, wall - wait);
  const tested = s.test === true;
  const result = computeScore({
    brs: req.brs.length,
    passed: tested ? passedBrs(req, report, plan?.cases ?? []) : null,
    rework: s.counters.rework + s.counters.contract_retries,
    scope_violations: s.counters.scope_violations,
    blockers: s.counters.blockers,
    rating: s.rating ?? 0,
    effective,
    minutes,
    planned: arch.tasks.length,
    merged: arch.tasks.filter((t) => s.tasks[t.id]?.status === 'merged').length,
  });
  return {
    id: s.id,
    project: s.project,
    name: s.name,
    ...result,
    tested,
    intensity: s.intensity,
    brs: req.brs.length,
    effective,
    cost: Math.round(cost * 100) / 100,
    minutes: r1(minutes),
    wait_minutes: r1(wait),
    scored_at: store.now(),
  };
}

export function recordScore(s: State): ScoreRecord {
  ensureSeed();
  const rec = scoreRun(s);
  store.appendLine(file(), rec);
  return rec;
}

export function comparable(rec: ScoreRecord): { previous?: number; best?: number } {
  const others = history().filter((r) => r.id !== rec.id && r.tested === rec.tested && (r.seeded || r.intensity === rec.intensity));
  if (!others.length) return {};
  return { previous: others.at(-1)!.score, best: Math.max(...others.map((r) => r.score)) };
}
