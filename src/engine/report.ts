import type { Architecture, Bug, BugReport, OrcsEvent, Risk, State, Usage } from '../types.ts';
import { envLabel, minutes, money, tokens } from '../view.ts';
import { comparable, history, waitMinutes, type ScoreRecord } from './score.ts';
import * as store from './store.ts';

export interface AgentRow {
  agent: string;
  models: string;
  sessions: number;
  turns: number;
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
  effective: number;
  share: number;
  cost: number;
}

export interface ReportData {
  id: string;
  name: string;
  score?: ScoreRecord;
  previous?: number;
  best?: number;
  effective: number;
  cost: number;
  minutes: number;
  wait_minutes: number;
  agents: AgentRow[];
  tasks: { task: string; title: string; sessions: number; fixes: number; effective: number; cost: number }[];
  rework: { gate: string; count: number; tasks: string }[];
  questions: { from: string; count: number }[];
  bugs: { risk: Risk; total: number; fixed: number }[];
  bug_types: { type: string; count: number }[];
  cost_note: string;
}

const AGENT_ORDER = ['analyst', 'architect', 'developer', 'tester', 'security'];

export function reportData(id: string): ReportData {
  const s = store.loadState(id);
  const usage = store.readLines<Usage>(store.runFile(id, 'usage.jsonl'));
  const total = usage.reduce((n, u) => n + u.effective, 0);
  const agents: AgentRow[] = [];
  for (const name of AGENT_ORDER) {
    const rows = usage.filter((u) => u.agent === name);
    if (!rows.length) continue;
    const sum = (k: 'turns' | 'input' | 'output' | 'cache_write' | 'cache_read' | 'effective' | 'cost') => rows.reduce((n, u) => n + u[k], 0);
    agents.push({
      agent: name,
      models: [...new Set(rows.map((u) => u.model.replace(/^claude-/, '')))].join(', '),
      sessions: new Set(rows.map((u) => u.session)).size,
      turns: sum('turns'),
      input: sum('input'),
      output: sum('output'),
      cache_write: sum('cache_write'),
      cache_read: sum('cache_read'),
      effective: sum('effective'),
      share: total ? Math.round((sum('effective') / total) * 1000) / 10 : 0,
      cost: sum('cost'),
    });
  }
  const tasks = Object.values(s.tasks)
    .filter((t) => t.kind !== 'plan')
    .map((t) => {
      const rows = usage.filter((u) => u.task === t.id);
      return {
        task: t.id,
        title: t.title,
        sessions: new Set(rows.map((u) => u.session)).size,
        fixes: t.fails,
        effective: rows.reduce((n, u) => n + u.effective, 0),
        cost: rows.reduce((n, u) => n + u.cost, 0),
      };
    });
  const byGate = new Map<string, string[]>();
  for (const e of store.readLines<OrcsEvent>(store.runFile(id, 'events.jsonl'))) {
    if (e.kind !== 'rework' || !e.gate) continue;
    byGate.set(e.gate, [...(byGate.get(e.gate) ?? []), e.task ?? 'agent']);
  }
  const rework = [...byGate].map(([gate, list]) => {
    const counts = new Map<string, number>();
    for (const t of list) counts.set(t, (counts.get(t) ?? 0) + 1);
    return { gate, count: list.length, tasks: [...counts].map(([t, n]) => (n > 1 ? `${t} x${n}` : t)).join(', ') };
  });
  const qCount = new Map<string, number>();
  for (const q of store.questions(id)) {
    const from = /^(dev|fix)-/.test(q.from) ? 'developers' : q.from;
    qCount.set(from, (qCount.get(from) ?? 0) + 1);
  }
  const report = store.readJsonIf<BugReport>(store.runFile(id, 'bugs.json'));
  const bugs = (['high', 'medium', 'low'] as const)
    .map((risk) => {
      const group = report?.bugs.filter((b) => b.risk === risk) ?? [];
      return { risk, total: group.length, fixed: group.filter((b) => b.status === 'fixed').length };
    })
    .filter((b) => b.total);
  const types = new Map<string, number>();
  for (const b of report?.bugs ?? []) types.set(b.type, (types.get(b.type) ?? 0) + 1);
  const score = history().find((r) => r.id === id);
  const wait = waitMinutes(id);
  const end = s.ended_at ? Date.parse(s.ended_at) : Date.now();
  const priced = usage.some((u) => u.cost_basis.includes('orcs prices'));
  return {
    id,
    name: s.name,
    ...(score ? { score, ...comparable(score) } : {}),
    effective: total,
    cost: usage.reduce((n, u) => n + u.cost, 0),
    minutes: Math.max(0, (end - Date.parse(s.created_at)) / 60_000 - wait),
    wait_minutes: wait,
    agents,
    tasks,
    rework,
    questions: [...qCount].map(([from, count]) => ({ from, count })),
    bugs,
    bug_types: [...types].map(([type, count]) => ({ type, count })),
    cost_note: priced ? 'Some costs use the Orcs price table, because Claude Code could not price that model.' : '',
  };
}

function md(headers: string[], rows: (string | number)[][]): string {
  return [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

export function reportMarkdown(d: ReportData): string {
  const out: string[] = [`# ${d.id} · ${d.name}`, ''];
  const score = d.score ? `Score ${d.score.score}${d.previous !== undefined ? ` (last ${d.previous}, best ${d.best})` : ''}` : 'Not scored yet';
  out.push(`${score} · ${tokens(d.effective)} effective tokens · ${money(d.cost)} · ${minutes(d.minutes)} (your time ${minutes(d.wait_minutes)})`, '');
  out.push('## Tokens by agent', '');
  out.push(md(['Agent', 'Model', 'Sessions', 'Turns', 'Input', 'Output', 'Cache write', 'Cache read', 'Effective', 'Share', 'Cost'],
    d.agents.map((a) => [a.agent, a.models, a.sessions, a.turns, tokens(a.input), tokens(a.output), tokens(a.cache_write), tokens(a.cache_read), tokens(a.effective), `${a.share}%`, money(a.cost)])), '');
  out.push('Effective tokens = input + output + cache write + 0.1 x cache read.', '');
  if (d.tasks.length) {
    out.push('## Developer tasks', '');
    out.push(md(['Task', 'Title', 'Sessions', 'Fix rounds', 'Effective', 'Cost'], d.tasks.map((t) => [t.task, t.title, t.sessions, t.fixes, tokens(t.effective), money(t.cost)])), '');
  }
  out.push('## Rework by gate', '');
  out.push(d.rework.length ? d.rework.map((r) => `- ${r.gate}: ${r.count} rerun${r.count > 1 ? 's' : ''} (${r.tasks})`).join('\n') : '- None.', '');
  out.push('## Questions', '');
  out.push(d.questions.length ? d.questions.map((q) => `- ${q.from}: ${q.count}`).join('\n') : '- None.', '');
  if (d.bugs.length) {
    out.push('## Bugs', '');
    out.push(d.bugs.map((b) => `- ${b.risk}: ${b.total} (fixed ${b.fixed})`).join('\n'), '');
    if (d.bug_types.length) out.push(`By type: ${d.bug_types.map((t) => `${t.type} ${t.count}`).join(', ')}`, '');
  }
  if (d.score) {
    out.push('## Score', '');
    out.push(md(['Factor', 'Value', 'Points'], Object.entries(d.score.factors).map(([k, v]) => [k, v === null ? 'not tested' : v, d.score!.points[k as keyof ScoreRecord['points']] ?? '-'])), '');
    out.push(`Tested: ${d.score.tested ? `yes, ${d.score.intensity} intensity` : 'no'}.${d.score.capped ? ' Capped at 60 because a requirement did not pass.' : ''}`, '');
  }
  if (d.cost_note) out.push(d.cost_note, '');
  return out.join('\n');
}

export function writeReport(id: string): string {
  const file = store.runFile(id, 'report.md');
  store.writeText(file, reportMarkdown(reportData(id)));
  return file;
}

function csvCell(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

export function bugCsv(bugs: Bug[], arch?: Architecture): string {
  const head = ['id', 'risk', 'type', 'requirement', 'environment', 'title', 'steps', 'expected', 'actual', 'evidence', 'status'];
  const rows = bugs.map((b) => [b.id, b.risk, b.type, b.br, envLabel(arch, b.env), b.title, b.steps.map((x, i) => `${i + 1}) ${x}`).join(' '), b.expected, b.actual, b.evidence, b.status]);
  return [head.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n') + '\n';
}

export function writeBugCsv(s: State, bugs: Bug[], arch?: Architecture): string {
  const file = store.runFile(s.id, 'bug-report.csv');
  store.writeText(file, bugCsv(bugs, arch));
  return file;
}
