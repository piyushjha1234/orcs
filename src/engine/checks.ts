import type { Architecture, Bug, Intensity, Requirement, Targets, Task, TestCase } from '../types.ts';

const UI = ['web', 'ios', 'android', 'desktop'];
const HEAVY = ['load', 'stress', 'performance'];

function dupes(ids: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const id of ids) (seen.has(id) ? out : seen).add(id);
  return [...out];
}

const clean = (p: string) => p.replace(/^\.\//, '');

export function inside(file: string, dir: string): boolean {
  const d = clean(dir).replace(/\/?$/, '/');
  return clean(file).startsWith(d) || clean(file) === d.slice(0, -1);
}

export function overlaps(a: string, b: string): boolean {
  const x = clean(a), y = clean(b);
  if (x === y) return true;
  return (x.endsWith('/') && y.startsWith(x)) || (y.endsWith('/') && x.startsWith(y));
}

export function outOfScope(files: string[], allowed: string[]): string[] {
  return files.filter((f) => !allowed.some((a) => (a.endsWith('/') ? clean(f).startsWith(clean(a)) : clean(f) === clean(a))));
}

export const REQUIREMENT_FIELDS = ['goal', 'users', 'non_goals', 'brs', 'targets', 'constraints', 'assumptions'] as const;
export const ARCHITECTURE_FIELDS = ['stack', 'setup', 'interfaces', 'developers', 'tasks', 'test_scope', 'flow', 'usage'] as const;

export function pick<T>(out: Record<string, unknown>, fields: readonly string[]): T {
  return Object.fromEntries(fields.map((f) => [f, out[f]])) as T;
}

function missing(out: Record<string, unknown>, fields: readonly string[]): string[] {
  return fields.filter((f) => out[f] === undefined).map((f) => `status is done but ${f} is missing`);
}

export function checkRequirement(out: Record<string, unknown>): string[] {
  if (out.status !== 'done') return [];
  const gaps = missing(out, REQUIREMENT_FIELDS);
  if (gaps.length) return gaps;
  const r = out as unknown as Requirement;
  const errors: string[] = [];
  if (!r.goal.trim()) errors.push('goal is empty');
  for (const id of dupes(r.brs.map((b) => b.id))) errors.push(`${id} is used twice`);
  for (const b of r.brs) if (!b.ac.some((c) => c.trim())) errors.push(`${b.id} has no acceptance criteria`);
  if (!r.targets.platforms.length) errors.push('targets.platforms is empty');
  return errors;
}

export function minTypes(t: Targets): string[] {
  const need = ['functional', 'e2e', 'regression'];
  if (t.platforms.some((p) => UI.includes(p))) need.push('ui', 'ux', 'accessibility', 'responsive', 'compatibility');
  if (t.platforms.includes('api') || t.public_api) need.push('api');
  if (t.expected_users > 0) need.push('load', 'stress');
  if (t.logins || t.personal_data) need.push('security');
  return need;
}

export function ancestors(tasks: Task[]): Map<string, Set<string>> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const memo = new Map<string, Set<string>>();
  const visit = (id: string, path: Set<string>): Set<string> => {
    const hit = memo.get(id);
    if (hit) return hit;
    const all = new Set<string>();
    for (const d of byId.get(id)?.deps ?? []) {
      if (path.has(d) || !byId.has(d)) continue;
      all.add(d);
      for (const x of visit(d, new Set([...path, d]))) all.add(x);
    }
    memo.set(id, all);
    return all;
  };
  for (const t of tasks) visit(t.id, new Set([t.id]));
  return memo;
}

export function cycles(tasks: Task[]): string[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map<string, 1 | 2>();
  const bad = new Set<string>();
  const dfs = (id: string, stack: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      for (const x of stack.slice(stack.indexOf(id))) bad.add(x);
      return;
    }
    state.set(id, 1);
    for (const d of byId.get(id)?.deps ?? []) if (byId.has(d)) dfs(d, [...stack, d]);
    state.set(id, 2);
  };
  for (const t of tasks) dfs(t.id, [t.id]);
  return [...bad];
}

export function checkArchitecture(out: Record<string, unknown>, req: Requirement, skills: string[]): string[] {
  if (out.status !== 'done') return [];
  const gaps = missing(out, ARCHITECTURE_FIELDS);
  if (gaps.length) return gaps;
  const a = out as unknown as Architecture;
  const errors: string[] = [];
  const brs = new Set(req.brs.map((b) => b.id));
  const taskIds = new Set(a.tasks.map((t) => t.id));
  const ifIds = new Set(a.interfaces.map((i) => i.id));
  for (const id of dupes([...a.interfaces.map((i) => i.id), ...a.tasks.map((t) => t.id), ...a.test_scope.matrix.map((e) => e.id), ...a.flow.steps.map((s) => s.id)])) errors.push(`${id} is used twice`);
  const covered = new Set<string>();
  for (const t of a.tasks) {
    for (const b of t.brs) brs.has(b) ? covered.add(b) : errors.push(`${t.id} names unknown ${b}`);
    for (const d of t.deps) if (!taskIds.has(d) || d === t.id) errors.push(`${t.id} depends on unknown ${d}`);
    for (const i of t.interfaces) if (!ifIds.has(i)) errors.push(`${t.id} names unknown ${i}`);
    for (const s of t.skills) if (!skills.includes(s)) errors.push(`${t.id} names skill ${s}, which this project does not have`);
    if (!t.test.trim()) errors.push(`${t.id} has no test command`);
    if (a.setup.tests_dir.trim()) for (const f of t.files) if (inside(f, a.setup.tests_dir) || overlaps(f, a.setup.tests_dir)) errors.push(`${t.id} owns ${f} inside tests_dir`);
  }
  for (const b of req.brs) if (b.priority !== 'could' && !covered.has(b.id)) errors.push(`${b.id} (${b.priority}) is not covered by any task`);
  for (const id of cycles(a.tasks)) errors.push(`${id} is part of a dependency cycle`);
  const anc = ancestors(a.tasks);
  for (let i = 0; i < a.tasks.length; i++) {
    for (let j = i + 1; j < a.tasks.length; j++) {
      const x = a.tasks[i], y = a.tasks[j];
      const shared = x.files.filter((f) => y.files.some((g) => overlaps(f, g)));
      if (shared.length && !anc.get(x.id)?.has(y.id) && !anc.get(y.id)?.has(x.id)) errors.push(`${x.id} and ${y.id} share ${shared[0]} but neither depends on the other`);
    }
  }
  if (!a.setup.tests_dir.trim()) errors.push('setup.tests_dir is empty');
  if (!a.setup.commands.acceptance.trim()) errors.push('setup.commands.acceptance is empty');
  for (const t of minTypes(req.targets)) if (!a.test_scope.types.includes(t)) errors.push(`test_scope.types needs ${t} for these targets`);
  if (!a.test_scope.matrix.some((e) => e.primary)) errors.push('test_scope.matrix has no primary environment');
  const steps = new Set(a.flow.steps.map((s) => s.id));
  for (const l of a.flow.links) if (!steps.has(l.from) || !steps.has(l.to)) errors.push(`flow link ${l.from} to ${l.to} names an unknown step`);
  return errors;
}

export function needs(intensity: Intensity, req: Requirement, arch: Architecture): { brs: string[]; types: string[]; envs: string[] } {
  const brs = req.brs.filter((b) => intensity !== 'low' || b.priority === 'must').map((b) => b.id);
  const types = arch.test_scope.types.filter((t) => intensity !== 'low' || !HEAVY.includes(t));
  const primary = arch.test_scope.matrix.filter((e) => e.primary);
  const envs = intensity === 'high' ? arch.test_scope.matrix : intensity === 'medium' ? primary : primary.slice(0, 1);
  return { brs, types, envs: envs.map((e) => e.id) };
}

export function checkTestPlan(out: Record<string, unknown>, req: Requirement, arch: Architecture, intensity: Intensity): string[] {
  if (out.status !== 'done') return [];
  const cases = out.cases as TestCase[] | undefined;
  const files = out.files as string[] | undefined;
  if (!cases || !files) return ['status is done but cases or files are missing'];
  const errors: string[] = [];
  const brs = new Set(req.brs.map((b) => b.id));
  const envs = new Set(arch.test_scope.matrix.map((e) => e.id));
  for (const id of dupes(cases.map((c) => c.id))) errors.push(`${id} is used twice`);
  for (const c of cases) {
    if (!brs.has(c.br)) errors.push(`${c.id} names unknown ${c.br}`);
    if (!arch.test_scope.types.includes(c.type)) errors.push(`${c.id} type ${c.type} is not in test_scope`);
    for (const e of c.envs) if (!envs.has(e)) errors.push(`${c.id} names unknown ${e}`);
  }
  for (const f of files) if (!inside(f, arch.setup.tests_dir)) errors.push(`${f} is outside tests_dir`);
  const need = needs(intensity, req, arch);
  for (const b of need.brs) if (!cases.some((c) => c.br === b)) errors.push(`no case covers ${b}`);
  for (const t of need.types) if (!cases.some((c) => c.type === t)) errors.push(`no case covers test type ${t}`);
  for (const e of need.envs) if (!cases.some((c) => c.envs.includes(e))) errors.push(`no case runs on ${e}`);
  return errors;
}

export function checkBugs(out: Record<string, unknown>, req: Requirement, arch: Architecture): string[] {
  if (out.status !== 'done') return [];
  const bugs = out.bugs as Bug[] | undefined;
  if (!bugs || !out.results) return ['status is done but results or bugs are missing'];
  const errors: string[] = [];
  const brs = new Set(req.brs.map((b) => b.id));
  const envs = new Set(arch.test_scope.matrix.map((e) => e.id));
  for (const id of dupes(bugs.map((b) => b.id))) errors.push(`${id} is used twice`);
  for (const b of bugs) {
    if (b.br !== 'none' && !brs.has(b.br)) errors.push(`${b.id} names unknown ${b.br}`);
    if (b.env !== 'none' && !envs.has(b.env)) errors.push(`${b.id} names unknown ${b.env}`);
  }
  return errors;
}

export function readyTasks(tasks: Task[], merged: Set<string>, busy: Set<string>): Task[] {
  return tasks.filter((t) => !merged.has(t.id) && !busy.has(t.id) && t.deps.every((d) => merged.has(d)));
}
