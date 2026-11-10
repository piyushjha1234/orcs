import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Answer, OrcsEvent, Question, State } from '../types.ts';

export const bus = new EventEmitter();

export const now = (): string => new Date().toISOString();

export function home(): string {
  return process.env.ORCS_HOME || path.join(os.homedir(), '.orcs');
}

export function runDir(id: string): string {
  return path.join(home(), 'runs', id);
}

export function runFile(id: string, name: string): string {
  return path.join(runDir(id), name);
}

export function worktreeDir(id: string, name = ''): string {
  return path.join(home(), 'worktrees', id, name);
}

export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

export function readJsonIf<T>(file: string): T | undefined {
  return fs.existsSync(file) ? readJson<T>(file) : undefined;
}

export function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

export function writeText(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export function appendLine(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(data) + '\n');
}

export function readLines<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  const out: T[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // a half-written last line is skipped
    }
  }
  return out;
}

export function frontmatter(text: string): { data: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { data, body: m[2] };
}

export function sha256File(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function removeRun(id: string): void {
  const state = loadState(id);
  if (state.status !== 'running') throw new Error(`${id} is not running.`);
  if (state.pid && state.pid !== process.pid) {
    try { process.kill(state.pid, 'SIGTERM'); } catch { /* the process has already stopped */ }
  }
  fs.rmSync(runDir(id), { recursive: true, force: true });
  fs.rmSync(worktreeDir(id), { recursive: true, force: true });
}

export function listRunIds(): string[] {
  const dir = path.join(home(), 'runs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((d) => /^orcs-\d+$/.test(d) && fs.existsSync(path.join(dir, d, 'state.json')))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
}

export function nextRunId(): string {
  const ids = [...listRunIds(), ...readLines<{ id: string }>(path.join(home(), 'scores.jsonl')).map((r) => r.id)];
  const max = ids.reduce((m, id) => Math.max(m, Number(/^orcs-(\d+)$/.exec(id)?.[1] ?? 0)), 0);
  return `orcs-${max + 1}`;
}

export function loadState(id: string): State {
  const file = runFile(id, 'state.json');
  if (!fs.existsSync(file)) throw new Error(`No run called ${id}.`);
  return readJson<State>(file);
}

export function saveState(state: State): void {
  state.updated_at = now();
  writeJson(runFile(state.id, 'state.json'), state);
  bus.emit('state', state);
}

export function event(id: string, kind: string, text: string, extra: { task?: string; gate?: string } = {}): void {
  const e: OrcsEvent = { at: now(), kind, text, ...extra };
  appendLine(runFile(id, 'events.jsonl'), e);
  bus.emit('event', e);
}

export function questions(id: string): Question[] {
  return readLines<Question>(runFile(id, 'inbox.jsonl'));
}

export function answers(id: string): Map<string, Answer> {
  const map = new Map<string, Answer>();
  for (const a of readLines<Answer>(runFile(id, 'answers.jsonl'))) if (!map.has(a.id)) map.set(a.id, a);
  return map;
}

export function pending(id: string): Question[] {
  const done = answers(id);
  return questions(id).filter((q) => !done.has(q.id));
}

export function ask(id: string, q: Omit<Question, 'id' | 'created_at'>): Question {
  const full: Question = { ...q, id: `q-${questions(id).length + 1}`, created_at: now() };
  appendLine(runFile(id, 'inbox.jsonl'), full);
  bus.emit('question', full);
  return full;
}

export function toAnswer(q: Question, raw: string): { choice?: number; text?: string } | string {
  const s = raw.trim();
  if (!s) return 'Type a number or an answer.';
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n >= 1 && n <= q.options.length) return { choice: n };
    if (!q.free_text) return `Pick a number from 1 to ${q.options.length}.`;
  }
  if (!q.free_text) return `Pick a number from 1 to ${q.options.length}.`;
  return { text: s };
}

export function answer(id: string, qid: string, raw: string, by: string): Answer {
  const q = questions(id).find((x) => x.id === qid);
  if (!q) throw new Error(`No question ${qid} in ${id}.`);
  if (answers(id).has(qid)) throw new Error(`${qid} is already answered.`);
  const parsed = toAnswer(q, raw);
  if (typeof parsed === 'string') throw new Error(parsed);
  const a: Answer = { id: qid, ...parsed, at: now(), by };
  appendLine(runFile(id, 'answers.jsonl'), a);
  bus.emit('answer', a);
  return a;
}

export function answerText(q: Question, a: Answer): string {
  return a.choice ? q.options[a.choice - 1] : (a.text ?? '');
}

export async function waitAnswer(id: string, qid: string): Promise<Answer> {
  for (;;) {
    const a = answers(id).get(qid);
    if (a) return a;
    await new Promise((r) => setTimeout(r, 700));
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function isRunning(state: State): boolean {
  return !!state.pid && state.pid !== process.pid && alive(state.pid);
}

export function lock(state: State): void {
  if (isRunning(state)) throw new Error(`${state.id} is already running (process ${state.pid}).`);
  state.pid = process.pid;
  saveState(state);
}

export function unlock(state: State): void {
  if (state.pid === process.pid) {
    delete state.pid;
    saveState(state);
  }
}
