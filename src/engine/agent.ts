import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { Agent, AgentQuestion, Convo, Mode, Role, State, Usage } from '../types.ts';
import { track } from './git.ts';
import { lessonsFor, rememberMistake } from './lessons.ts';
import { projectSkills } from './skills.ts';
import * as store from './store.ts';
import { brief } from '../view.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const LADDER = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];
export const MODELS: readonly string[] = LADDER;
export const ROLES: readonly Role[] = ['analyst', 'architect', 'developer', 'tester'];

export class StopRun extends Error {}
export class SchemaError extends Error {}

export interface AgentDef {
  role: Role;
  model: string;
  effort?: string;
  tools: string[];
  file: string;
}

function settingsFile(): string {
  return path.join(store.home(), 'settings.json');
}

// Models picked in orcs ui. Only models on the ladder count, so stepping up to a stronger model still works.
export function modelOverrides(): Partial<Record<Role, string>> {
  let saved: { models?: Record<string, unknown> } | undefined;
  try {
    saved = store.readJsonIf(settingsFile());
  } catch {
    saved = undefined;
  }
  const out: Partial<Record<Role, string>> = {};
  for (const role of ROLES) {
    const m = saved?.models?.[role];
    if (typeof m === 'string' && LADDER.includes(m)) out[role] = m;
  }
  return out;
}

export function saveModelOverrides(models: Partial<Record<Role, string>>): void {
  const clean: Partial<Record<Role, string>> = {};
  for (const role of ROLES) {
    const m = models[role];
    if (m && LADDER.includes(m)) clean[role] = m;
  }
  let saved: Record<string, unknown> = {};
  try {
    saved = store.readJsonIf<Record<string, unknown>>(settingsFile()) ?? {};
  } catch {
    saved = {};
  }
  store.writeJson(settingsFile(), { ...saved, models: clean });
}

export function defaultModel(role: Role): string {
  const { data } = store.frontmatter(fs.readFileSync(path.join(ROOT, 'agents', `${role}.md`), 'utf8'));
  return data.model;
}

export function loadAgent(role: Role): AgentDef {
  const file = path.join(ROOT, 'agents', `${role}.md`);
  const { data } = store.frontmatter(fs.readFileSync(file, 'utf8'));
  const tools = (data.tools || '').split(',').map((t) => t.trim()).filter(Boolean);
  return { role, model: modelOverrides()[role] ?? data.model, effort: data.effort || undefined, tools, file };
}

export function launchMode(state: State): Mode {
  if (state.intake.global_skills) return 'global';
  return projectSkills(state.project).length ? 'project' : 'safe';
}

export function modeFlags(mode: Mode): string[] {
  if (mode === 'safe') return ['--safe-mode'];
  if (mode === 'project') {
    const user = store.readJsonIf<Record<string, unknown>>(path.join(os.homedir(), '.claude', 'settings.json')) ?? {};
    const auth: Record<string, unknown> = {};
    for (const k of ['apiKeyHelper', 'env', 'modelOverrides']) if (user[k] !== undefined) auth[k] = user[k];
    return ['--setting-sources', 'project,local', '--settings', JSON.stringify({ ...auth, autoMemoryEnabled: false, disableAllHooks: true })];
  }
  const claudeMd = path.join(os.homedir(), '.claude', 'CLAUDE.md');
  return ['--setting-sources', 'user,project,local', '--settings', JSON.stringify({ disableAllHooks: true, autoMemoryEnabled: false, claudeMdExcludes: [claudeMd] })];
}

export function schema(name: string): string {
  const question = fs.readFileSync(path.join(ROOT, 'schemas', 'question.json'), 'utf8');
  return fs.readFileSync(path.join(ROOT, 'schemas', `${name}.json`), 'utf8')
    .replace(/\{\s*"\$ref":\s*"question\.json"\s*\}/g, question.trim());
}

export function stronger(model: string): string | undefined {
  const i = LADDER.indexOf(model);
  return i >= 0 && i < LADDER.length - 1 ? LADDER[i + 1] : undefined;
}

interface Price {
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

interface ModelUse {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUSD?: number;
  costBasis?: string;
  canonicalModel?: string;
}

interface ClaudeResult {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
  session_id?: string;
  num_turns?: number;
  duration_ms?: number;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  modelUsage?: Record<string, ModelUse>;
}

export function toUsage(res: ClaudeResult, base: { run: string; agent: Agent; task?: string; model: string; session: string; duration_ms: number }): Usage {
  const prices = store.readJson<Record<string, Price>>(path.join(ROOT, 'config', 'prices.json'));
  let input = 0, output = 0, write = 0, read = 0, cost = 0;
  const bases = new Set<string>();
  const entries = Object.entries(res.modelUsage ?? {});
  for (const [name, m] of entries) {
    const u = { i: m.inputTokens ?? 0, o: m.outputTokens ?? 0, w: m.cacheCreationInputTokens ?? 0, r: m.cacheReadInputTokens ?? 0 };
    input += u.i; output += u.o; write += u.w; read += u.r;
    const p = prices[m.canonicalModel ?? name];
    if (m.costBasis !== 'list' && p) {
      cost += (u.i * p.input + u.o * p.output + u.w * p.cache_write + u.r * p.cache_read) / 1e6;
      bases.add('orcs prices');
    } else {
      cost += m.costUSD ?? 0;
      bases.add(m.costBasis ?? 'claude');
    }
  }
  if (!entries.length && res.usage) {
    input = res.usage.input_tokens ?? 0;
    output = res.usage.output_tokens ?? 0;
    write = res.usage.cache_creation_input_tokens ?? 0;
    read = res.usage.cache_read_input_tokens ?? 0;
    cost = res.total_cost_usd ?? 0;
  }
  return {
    at: store.now(),
    run: base.run,
    agent: base.agent,
    ...(base.task ? { task: base.task } : {}),
    model: base.model,
    session: base.session,
    turns: res.num_turns ?? 0,
    input,
    output,
    cache_write: write,
    cache_read: read,
    effective: Math.round(input + output + write + 0.1 * read),
    cost: Math.round(cost * 1e6) / 1e6,
    cost_basis: [...bases].join(', ') || 'claude',
    duration_ms: res.duration_ms ?? base.duration_ms,
    outcome: res.is_error ? `error: ${res.subtype ?? 'unknown'}` : 'ok',
  };
}

function run(bin: string, args: string[], cwd: string, input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    track(p);
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr = (stderr + d).slice(-20_000)));
    p.on('error', (e) => resolve({ code: 127, stdout, stderr: String(e) }));
    p.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    p.stdin.end(input ?? '');
  });
}

export interface CallOpts {
  state: State;
  agent: Agent;
  role: Role;
  task?: string;
  cwd: string;
  prompt: string;
  schemaName: string;
  session: string;
  resume: boolean;
  model?: string;
}

export async function callClaude(o: CallOpts): Promise<unknown> {
  const def = loadAgent(o.role);
  const mode = launchMode(o.state);
  const tools = [...def.tools, ...(mode !== 'safe' && (o.role === 'developer' || o.role === 'tester') ? ['Skill'] : [])];
  const model = o.model ?? def.model;
  const slash = o.prompt.startsWith('/');
  const args = [
    '-p', ...modeFlags(mode), '--strict-mcp-config',
    '--model', model, ...(def.effort ? ['--effort', def.effort] : []),
    '--tools', tools.join(','), '--permission-mode', 'dontAsk', '--allowedTools', tools.join(','),
    ...(slash ? [] : ['--append-system-prompt-file', def.file]),
    '--json-schema', schema(o.schemaName), '--output-format', 'json',
    ...(o.resume ? ['--resume', o.session] : ['--session-id', o.session]),
    ...(slash ? [o.prompt] : []),
  ];
  const started = Date.now();
  const r = await run(process.env.ORCS_CLAUDE_BIN || 'claude', args, o.cwd, slash ? undefined : o.prompt);
  let res: ClaudeResult;
  try {
    res = JSON.parse(r.stdout) as ClaudeResult;
  } catch {
    throw new Error(`${o.task ?? o.agent}: Claude gave no result. ${brief((r.stderr || r.stdout).trim(), 2)}`);
  }
  const usage = toUsage(res, { run: o.state.id, agent: o.agent, task: o.task, model, session: o.session, duration_ms: Date.now() - started });
  store.appendLine(store.runFile(o.state.id, 'usage.jsonl'), usage);
  if (res.subtype === 'error_max_structured_output_retries') throw new SchemaError(`${o.task ?? o.agent}: output did not match the schema.`);
  if (res.is_error || r.code !== 0) throw new Error(`${o.task ?? o.agent}: Claude stopped with an error (${res.subtype ?? r.code}). ${brief(String(res.result ?? ''), 2)}`);
  if (res.structured_output !== undefined) return res.structured_output;
  try {
    return JSON.parse(res.result ?? '');
  } catch {
    throw new Error(`${o.task ?? o.agent}: Claude returned no structured output.`);
  }
}

export async function repeatPause(state: State, who: string, convo: Convo, problem: string): Promise<void> {
  const up = stronger(convo.model);
  const options = up ? [`Retry on ${up}`, 'Retry as is', 'Stop the run'] : ['Retry as is', 'Stop the run'];
  const q = store.ask(state.id, {
    from: 'orcs',
    text: `${who} failed the same check twice. What now?`,
    details: [brief(problem, 3)].filter(Boolean),
    options,
    recommended: 1,
  });
  store.event(state.id, 'pause', `${who} failed the same check twice. Waiting for you.`);
  const a = await store.waitAnswer(state.id, q.id);
  const pick = options[(a.choice ?? 1) - 1];
  convo.repeats = 0;
  if (pick === 'Stop the run') throw new StopRun(`Stopped after ${who} failed twice.`);
  if (up && pick.startsWith('Retry on')) {
    convo.model = up;
    store.event(state.id, 'model', `${who} now runs on ${up}.`);
  }
  store.saveState(state);
}

// Step up to a stronger model before asking the owner. The mistake stays with this agent.
export async function nudge(state: State, who: string, convo: Convo, problem: string): Promise<void> {
  const up = stronger(convo.model);
  if (convo.repeats === 1 && up) {
    convo.model = up;
    convo.repeats = 0;
    store.event(state.id, 'model', `${who} hit the same check again. Retrying on ${up}.`);
    store.saveState(state);
    return;
  }
  await repeatPause(state, who, convo, problem);
}

function teach(prompt: string, role: Role): string {
  const lessons = lessonsFor(role);
  if (!lessons.length || !prompt.startsWith('{')) return prompt;
  try {
    const body = JSON.parse(prompt) as Record<string, unknown>;
    body.lessons = lessons;
    return JSON.stringify(body);
  } catch {
    return prompt;
  }
}

export interface ConverseOpts {
  state: State;
  key: string;
  agent: Agent;
  role: Role;
  from: string;
  task?: string;
  cwd: string;
  first: string;
  schemaName: string;
  model?: string;
  check?: (out: Record<string, unknown>) => string[];
  onAsk?: () => void;
  onAnswered?: () => void;
}

export function newConvo(model: string, first: string): Convo {
  return { session: randomUUID(), started: false, model, pending: [], next_prompt: first, done: false, repeats: 0 };
}

export async function converse(o: ConverseOpts): Promise<Record<string, unknown>> {
  const s = o.state;
  let c = s.convos[o.key];
  if (!c) {
    c = s.convos[o.key] = newConvo(o.model ?? loadAgent(o.role).model, o.first);
    store.saveState(s);
  } else if (c.done) {
    c.done = false;
    c.next_prompt = JSON.stringify({ note: 'Return your last output again.' });
  }
  for (;;) {
    if (c.pending.length) {
      const qs = store.questions(s.id);
      const replies: { id: string; answer: string }[] = [];
      for (const qid of c.pending) {
        const a = await store.waitAnswer(s.id, qid);
        const q = qs.find((x) => x.id === qid);
        if (q) replies.push({ id: q.agent_qid ?? qid, answer: store.answerText(q, a) });
      }
      c.next_prompt = JSON.stringify({ answers: replies });
      c.pending = [];
      o.onAnswered?.();
      store.saveState(s);
    }
    let out: Record<string, unknown> = {};
    let schemaFailed = false;
    try {
      out = (await callClaude({ state: s, agent: o.agent, role: o.role, task: o.task, cwd: o.cwd, prompt: teach(c.next_prompt, o.role), schemaName: o.schemaName, session: c.session, resume: c.started, model: c.model })) as Record<string, unknown>;
    } catch (e) {
      if (!c.started && /already (in use|exists)/i.test(String(e))) {
        c.started = true;
        continue;
      }
      if (!(e instanceof SchemaError)) throw e;
      schemaFailed = true;
    }
    c.started = true;
    const asked = (out.questions as AgentQuestion[] | undefined) ?? [];
    if (!schemaFailed && out.status === 'ask' && asked.length) {
      c.pending = asked.map((q) => store.ask(s.id, { from: o.from, text: q.text, options: q.options, recommended: q.recommended, free_text: true, agent_qid: q.id }).id);
      o.onAsk?.();
      store.saveState(s);
      store.event(s.id, 'question', `${o.from} has ${asked.length === 1 ? 'a question' : `${asked.length} questions`} for you.`, { task: o.task });
      continue;
    }
    const errors = schemaFailed
      ? ['your output did not match the schema: send every field as a real JSON value, never an object or array written as a string']
      : out.status === 'ask' ? ['status is ask but there are no questions'] : (o.check?.(out) ?? []);
    if (errors.length) {
      s.counters.contract_retries++;
      const sig = errors.join('\n');
      c.repeats = sig === c.last_errors ? c.repeats + 1 : 0;
      c.last_errors = sig;
      store.event(s.id, 'rework', `${o.from} output failed ${errors.length} check${errors.length > 1 ? 's' : ''}. Sent back to fix.`, { task: o.task ?? o.from, gate: 'contract check' });
      rememberMistake(o.role, 'contract check', sig);
      if (c.repeats >= 1) await nudge(s, o.from, c, sig);
      c.next_prompt = JSON.stringify({ fix: errors });
      store.saveState(s);
      continue;
    }
    c.done = true;
    store.saveState(s);
    return out;
  }
}

export async function send(o: ConverseOpts, message: Record<string, unknown>): Promise<Record<string, unknown>> {
  const c = o.state.convos[o.key];
  if (!c) return converse(o);
  c.done = false;
  c.next_prompt = JSON.stringify(message);
  store.saveState(o.state);
  return converse(o);
}
