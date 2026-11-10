// Mistakes worth keeping. Later runs read these so the same failure is less likely.
import path from 'node:path';
import type { Role } from '../types.ts';
import { brief } from '../view.ts';
import { home, now, readJsonIf, writeJson } from './store.ts';

export interface Lesson {
  at: string;
  role: Role;
  gate: string;
  text: string;
  seen: number;
}

const MAX = 40;

function file(): string {
  return path.join(home(), 'lessons.json');
}

function load(): Lesson[] {
  return readJsonIf<Lesson[]>(file()) ?? [];
}

function save(role: Role, gate: string, detail: string): void {
  const text = brief(detail, 2);
  if (!text) return;
  const all = load();
  const hit = all.find((l) => l.role === role && l.gate === gate && l.text === text);
  if (hit) {
    hit.seen++;
    hit.at = now();
  } else {
    all.push({ at: now(), role, gate, text, seen: 1 });
  }
  all.sort((a, b) => b.seen - a.seen || b.at.localeCompare(a.at));
  writeJson(file(), all.slice(0, MAX));
}

export function rememberMistake(role: Role, gate: string, detail: string): void {
  save(role, gate, detail);
  if (role !== 'architect') save('architect', gate, detail);
}

export function lessonsFor(role: Role): string[] {
  return load()
    .filter((l) => l.role === role)
    .slice(0, 5)
    .map((l) => `${l.gate}: ${l.text}`);
}
