// The JSON shapes the web UI reads. They are built from the same files the CLI reads.
import type { OrcsEvent, Question, State, TaskState, Usage } from '../types.ts';
import { history } from '../engine/score.ts';
import * as store from '../engine/store.ts';
import { order, STAGE } from '../view.ts';

export const EVENT_WINDOW = 150;

export interface AnsweredQuestion {
  question: Question;
  answer: string;
  at: string;
}

export interface RunView {
  id: string;
  name: string;
  project: string;
  branch: string;
  stage: State['stage'];
  stage_label: string;
  status: State['status'];
  error: string | null;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
  test: boolean | null;
  intensity: State['intensity'];
  round: number;
  rating: number | null;
  security_review: boolean;
  skills: string[];
  counters: State['counters'];
  active: boolean;
  tasks: TaskState[];
  pending: Question[];
  answered: AnsweredQuestion[];
  usage: { effective: number; cost: number };
}

export interface RunSummary {
  id: string;
  name: string;
  stage: State['stage'];
  stage_label: string;
  status: State['status'];
  created_at: string;
  updated_at: string;
  ended_at: string | null;
  pending: number;
  score: number | null;
}

export function runSummaries(): RunSummary[] {
  const scores = new Map(history().map((r) => [r.id, r.score]));
  const out: RunSummary[] = [];
  for (const id of store.listRunIds()) {
    try {
      const s = store.loadState(id);
      out.push({
        id, name: s.name, stage: s.stage, stage_label: STAGE[s.stage], status: s.status,
        created_at: s.created_at, updated_at: s.updated_at, ended_at: s.ended_at ?? null,
        pending: store.pending(id).length, score: scores.get(id) ?? null,
      });
    } catch {
      // a half-written state file is skipped until the next refresh
    }
  }
  return out.reverse();
}

export function runView(id: string): RunView {
  const s = store.loadState(id);
  const questions = store.questions(id);
  const answers = store.answers(id);
  const usage = store.readLines<Usage>(store.runFile(id, 'usage.jsonl'));
  const answered: AnsweredQuestion[] = questions
    .filter((q) => answers.has(q.id))
    .map((q) => ({ question: q, answer: store.answerText(q, answers.get(q.id)!), at: answers.get(q.id)!.at }))
    .slice(-50);
  return {
    id: s.id,
    name: s.name,
    project: s.project,
    branch: s.branch,
    stage: s.stage,
    stage_label: STAGE[s.stage],
    status: s.status,
    error: s.error ?? null,
    created_at: s.created_at,
    updated_at: s.updated_at,
    ended_at: s.ended_at ?? null,
    test: s.test,
    intensity: s.intensity,
    round: s.round,
    rating: s.rating ?? null,
    security_review: s.security_review,
    skills: s.skills,
    counters: s.counters,
    active: store.isRunning(s),
    tasks: Object.values(s.tasks).sort((a, b) => order(a) - order(b)),
    pending: questions.filter((q) => !answers.has(q.id)),
    answered,
    usage: { effective: usage.reduce((n, u) => n + u.effective, 0), cost: usage.reduce((n, u) => n + u.cost, 0) },
  };
}

export function runEvents(id: string): { total: number; recent: (OrcsEvent & { seq: number })[] } {
  const all = store.readLines<OrcsEvent>(store.runFile(id, 'events.jsonl'));
  const start = Math.max(0, all.length - EVENT_WINDOW);
  return { total: all.length, recent: all.slice(start).map((e, i) => ({ seq: start + i, ...e })) };
}