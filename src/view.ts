// Every human-readable screen: plain words, short lines, a title next to every id.
import type { Architecture, Bug, BugReport, Question, Requirement, Stage, State, TaskState, Usage } from './types.ts';
import type { ReportData } from './engine/report.ts';
import type { ScoreRecord } from './engine/score.ts';

export function tokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}

export function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function minutes(m: number): string {
  if (m < 1) return 'under 1 min';
  if (m < 60) return `${Math.round(m)} min`;
  return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
}

export function since(iso: string | undefined): string {
  return iso ? minutes((Date.now() - Date.parse(iso)) / 60_000) : '';
}

export function short(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n - 1) + '…';
}

export function table(headers: string[], rows: (string | number)[][]): string[] {
  const cells = [headers, ...rows.map((r) => r.map(String))];
  const widths = headers.map((_, i) => Math.max(...cells.map((r) => (r[i] ?? '').length)));
  return cells.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join('  ').trimEnd());
}

const STAGE: Record<Stage, string> = {
  analyst: 'analyst working',
  skills: 'choosing skills',
  architect: 'architect working',
  build: 'building',
  test: 'testing',
  bugs: 'bug review',
  fix: 'fixing bugs',
  accept: 'waiting for acceptance',
  rating: 'rating',
  finish: 'finishing',
  done: 'done',
};

const WORD: Record<TaskState['status'], string> = {
  waiting: 'waiting',
  building: 'building',
  checking: 'checking',
  fixing: 'fixing',
  blocked: 'blocked',
  merged: 'done',
  failed: 'failed',
};

export function header(s: State, usage: Usage[]): string {
  const eff = usage.reduce((n, u) => n + u.effective, 0);
  const cost = usage.reduce((n, u) => n + u.cost, 0);
  const end = s.ended_at ? Date.parse(s.ended_at) : Date.now();
  const took = minutes((end - Date.parse(s.created_at)) / 60_000);
  return `${s.id} · ${s.name} · ${STAGE[s.stage]} · ${took} · ${tokens(eff)} tokens · ${money(cost)}`;
}

function order(t: TaskState): number {
  const n = Number(/(\d+)$/.exec(t.id)?.[1] ?? 0);
  return t.kind === 'build' ? n : t.kind === 'plan' ? 1000 : 2000 + n;
}

function taskLine(t: TaskState): string {
  let extra = '';
  if (t.status === 'building' || t.status === 'checking') extra = since(t.started_at);
  if (t.status === 'fixing') extra = `${t.last_check ?? 'check'} failed ${t.fails > 1 ? `${t.fails} times` : 'once'}`;
  if (t.status === 'blocked') extra = 'waiting for your answer';
  if (t.status === 'waiting') extra = t.note ?? '';
  const word = t.kind === 'plan' && t.status === 'building' ? 'working' : WORD[t.status];
  return `  ${word.padEnd(9)} ${t.id.padEnd(8)} ${short(t.title, 30).padEnd(30)} ${extra}`.trimEnd();
}

export function progress(s: State, usage: Usage[], waiting: number): string[] {
  const lines = [header(s, usage)];
  if (s.stage === 'analyst' || s.stage === 'architect') {
    const who = s.stage;
    const c = s.convos[who];
    lines.push(`  ${(c?.pending.length ? 'blocked' : 'working').padEnd(9)} ${who.padEnd(8)} ${who === 'analyst' ? 'writing the requirement' : 'designing the solution'}`);
  }
  const tasks = Object.values(s.tasks).sort((a, b) => order(a) - order(b));
  const done = tasks.filter((t) => t.status === 'merged');
  const shown = tasks.length > 10 ? tasks.filter((t) => t.status !== 'merged') : tasks;
  if (tasks.length > 10 && done.length) lines.push(`  ${'done'.padEnd(9)} ${done.length} tasks`);
  for (const t of shown) lines.push(taskLine(t));
  if (waiting) lines.push(`${waiting === 1 ? 'A question needs' : `${waiting} questions need`} you.`);
  else if (s.status === 'running') lines.push('Nothing needs you right now.');
  else if (s.status === 'done') lines.push('Finished.');
  else if (s.status === 'stopped' || s.status === 'failed') lines.push(`${s.status === 'failed' ? 'Failed' : 'Stopped'}: ${short(s.error ?? '', 70)}`);
  return lines;
}

export function questionView(q: Question): string[] {
  const who = q.from === 'orcs' ? 'Orcs' : q.from;
  const lines = [`${who} asks (${q.id}):`];
  for (const d of q.details ?? []) lines.push(`  ${d}`);
  lines.push(`  ${q.text}`);
  q.options.forEach((o, i) => lines.push(`  [${i + 1}] ${o}${i + 1 === q.recommended ? ' (recommended)' : ''}`));
  lines.push(q.options.length ? (q.free_text ? '  Type a number, or your own answer.' : '  Type a number.') : '  Type your answer.');
  return lines;
}

export function requirementSummary(req: Requirement): string[] {
  const n = (p: string) => req.brs.filter((b) => b.priority === p).length;
  const t = req.targets;
  const flags = [t.logins && 'logins', t.personal_data && 'personal data', t.payments && 'payments', t.public_api && 'public api'].filter(Boolean);
  const lines = [
    `Goal: ${short(req.goal, 72)}`,
    `${req.brs.length} requirements: ${n('must')} must, ${n('should')} should, ${n('could')} could.`,
    ...req.brs.slice(0, 12).map((b) => `  ${b.id.padEnd(6)} ${short(b.title, 60)} (${b.priority})`),
  ];
  if (req.brs.length > 12) lines.push(`  and ${req.brs.length - 12} more`);
  lines.push(`Targets: ${short([...t.platforms, ...t.devices, ...t.browsers].join(', ') || 'none', 60)}`);
  if (t.expected_users || flags.length) lines.push(`Also: ${[t.expected_users ? `${t.expected_users} users` : '', ...flags].filter(Boolean).join(', ')}`);
  if (req.non_goals.length) lines.push(`Not included: ${short(req.non_goals.join(', '), 62)}`);
  return lines;
}

export function architectureSummary(arch: Architecture): string[] {
  const lines = [`Stack: ${short(arch.stack.map((s) => s.choice).join(', '), 70)}`];
  lines.push(`${arch.tasks.length} tasks for up to ${arch.developers} developer${arch.developers > 1 ? 's' : ''} at once:`);
  for (const t of arch.tasks.slice(0, 12)) lines.push(`  ${t.id.padEnd(7)} ${short(t.title, 62)}`);
  if (arch.tasks.length > 12) lines.push(`  and ${arch.tasks.length - 12} more`);
  lines.push(`Tests: ${short(arch.test_scope.types.join(', '), 70)}`);
  lines.push(`Environments: ${short(arch.test_scope.matrix.map((e) => `${e.browser} on ${e.device}`).join(', '), 62)}`);
  return lines;
}

export function envLabel(arch: Architecture | undefined, id: string): string {
  const e = arch?.test_scope.matrix.find((x) => x.id === id);
  if (!e) return id === 'none' ? '' : id;
  return e.browser === 'none' ? e.device : `${e.browser} on ${e.device}`;
}

function where(b: Bug, arch?: Architecture): string {
  return [b.type, envLabel(arch, b.env)].filter(Boolean).join(' · ');
}

export function bugLines(report: BugReport, arch?: Architecture): string[] {
  const open = report.bugs.filter((b) => b.status === 'open');
  const fixed = report.bugs.length - open.length;
  const count = (r: string) => open.filter((b) => b.risk === r).length;
  const lines = [
    open.length
      ? `Testing found ${open.length} open bug${open.length > 1 ? 's' : ''}: ${count('high')} high, ${count('medium')} medium, ${count('low')} low.`
      : 'Testing found no open bugs.',
  ];
  if (fixed) lines.push(`${fixed} bug${fixed > 1 ? 's were' : ' was'} fixed.`);
  for (const risk of ['high', 'medium', 'low'] as const) {
    const group = open.filter((b) => b.risk === risk);
    if (!group.length) continue;
    lines.push(risk[0].toUpperCase() + risk.slice(1));
    for (const b of group) lines.push(`  ${b.id.padEnd(7)} ${short(b.title, 38).padEnd(38)} ${short(where(b, arch), 30)}`.trimEnd());
  }
  return lines;
}

export function bugDetail(b: Bug, arch?: Architecture): string[] {
  return [
    `${b.id} · ${b.risk} risk · ${b.status}`,
    `  ${b.title}`,
    `  Where: ${where(b, arch) || 'not known'}${b.br !== 'none' ? ` · ${b.br}` : ''}${b.file ? ` · ${b.file}` : ''}`,
    '  Steps:',
    ...b.steps.map((s, i) => `    ${i + 1}. ${s}`),
    `  Expected: ${b.expected}`,
    `  Actual: ${b.actual}`,
    `  Evidence: ${short(b.evidence, 300)}`,
  ];
}

export function reportView(d: ReportData): string[] {
  const lines: string[] = [];
  const score = d.score ? `Score ${d.score.score}${d.previous !== undefined ? ` (last ${d.previous}, best ${d.best})` : ''}` : 'Not scored yet';
  lines.push(`${d.id} · ${d.name}`);
  lines.push(`${score} · ${tokens(d.effective)} tokens · ${money(d.cost)} · ${minutes(d.minutes)} (your time ${minutes(d.wait_minutes)})`);
  lines.push('', 'Tokens by agent');
  lines.push(...table(['Agent', 'Model', 'Sessions', 'Turns', 'Effective', 'Share', 'Cost'],
    d.agents.map((a) => [a.agent, a.models, a.sessions, a.turns, tokens(a.effective), `${a.share}%`, money(a.cost)])).map((l) => `  ${l}`));
  if (d.tasks.length) {
    lines.push('', 'Developer tasks');
    lines.push(...table(['Task', 'Title', 'Sessions', 'Fix rounds', 'Effective', 'Cost'],
      d.tasks.map((t) => [t.task, short(t.title, 28), t.sessions, t.fixes, tokens(t.effective), money(t.cost)])).map((l) => `  ${l}`));
  }
  lines.push('', 'Rework by gate');
  if (d.rework.length) for (const r of d.rework) lines.push(`  ${r.gate}: ${r.count} rerun${r.count > 1 ? 's' : ''} (${r.tasks})`);
  else lines.push('  None.');
  lines.push('', `Questions: ${d.questions.map((q) => `${q.from} ${q.count}`).join(', ') || 'none'}`);
  if (d.bugs.length) {
    lines.push(`Bugs: ${d.bugs.map((b) => `${b.risk} ${b.total} (fixed ${b.fixed})`).join(', ')}`);
    if (d.bug_types.length) lines.push(`Bug types: ${d.bug_types.map((t) => `${t.type} ${t.count}`).join(', ')}`);
  }
  if (d.score) {
    lines.push('', 'Score breakdown');
    lines.push(...table(['Factor', 'Value', 'Points'],
      Object.entries(d.score.factors).map(([k, v]) => [k, v === null ? 'not tested' : v, d.score!.points[k as keyof ScoreRecord['points']] ?? '-'])).map((l) => `  ${l}`));
    if (d.score.capped) lines.push('  Capped at 60 because a requirement did not pass.');
  }
  if (d.cost_note) lines.push('', d.cost_note);
  return lines;
}

export function runList(states: State[], scores: Map<string, number>): string[] {
  if (!states.length) return ['No runs yet. Start one with: orcs new'];
  return table(['Id', 'Project', 'Stage', 'Status', 'Score'],
    states.map((s) => [s.id, short(s.name, 30), STAGE[s.stage], s.status, scores.get(s.id) ?? '-']));
}
