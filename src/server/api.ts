// JSON API for the web UI. Every route wraps an existing engine function; nothing here re-implements run logic.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Role } from '../types.ts';
import { defaultModel, modelOverrides, MODELS, ROLES, saveModelOverrides } from '../engine/agent.ts';
import { createRun } from '../engine/run.ts';
import { slug, validSource } from '../engine/intake.ts';
import { reportData } from '../engine/report.ts';
import { findSkills, parseSkillList } from '../engine/skills.ts';
import * as store from '../engine/store.ts';
import { runEvents, runSummaries, runView } from './model.ts';
import { chooseFolder } from './pick.ts';
import { streamRun } from './stream.ts';

export class HttpError extends Error {
  status: number;
  field?: string;
  constructor(status: number, message: string, field?: string) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

const MAX_BODY = 64_000;
const RUN_PATH = /^\/api\/runs\/(orcs-\d+)(?:\/(.+))?$/;

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'That is too much text.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
      } catch {
        reject(new HttpError(400, 'Could not read the request.'));
      }
    });
    req.on('error', reject);
  });
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

// Starts the engine in its own process, so it keeps running if this server stops.
// Its output goes to engine.log in the run folder.
export function startEngine(id: string): void {
  const cli = path.resolve(import.meta.dirname, '..', 'cli.ts');
  const log = fs.openSync(store.runFile(id, 'engine.log'), 'a');
  try {
    const child = spawn(process.execPath, [cli, 'resume', id], { detached: true, stdio: ['ignore', log, log], env: process.env });
    child.on('error', () => undefined);
    child.unref();
  } finally {
    fs.closeSync(log);
  }
}

function projectDir(base: string, name: string): string {
  const root = path.resolve(base.trim() || process.cwd());
  return name.trim() ? path.resolve(root, slug(name)) : root;
}

function listDirs(res: ServerResponse, raw: string): void {
  const dir = path.resolve(raw.trim() || process.cwd());
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch {
    throw new HttpError(422, 'That folder does not exist.', 'dir');
  }
  if (!stat.isDirectory()) throw new HttpError(422, 'That path is not a folder.', 'dir');
  let names: string[];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => !d.name.startsWith('.') && (d.isDirectory() || (d.isSymbolicLink() && safeDir(path.join(dir, d.name)))))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 200);
  } catch {
    throw new HttpError(422, 'That folder cannot be opened.', 'dir');
  }
  const parent = path.dirname(dir);
  json(res, 200, { path: dir, parent: parent === dir ? null : parent, dirs: names });
}

function safeDir(file: string): boolean {
  try {
    return fs.statSync(file).isDirectory();
  } catch {
    return false;
  }
}

function requireRun(id: string): void {
  if (!fs.existsSync(store.runFile(id, 'state.json'))) throw new HttpError(404, `No run called ${id}.`);
}

async function createFromBody(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const b = await readBody(req);
  const name = text(b.name).trim();
  if (!name) throw new HttpError(422, 'Give the project a name.', 'name');
  if (name.length > 80) throw new HttpError(422, 'Keep the name under 80 characters.', 'name');
  const requirements = text(b.requirements).trim();
  if (!requirements) throw new HttpError(422, 'Describe what the project should do.', 'requirements');
  if (requirements.length > 20_000) throw new HttpError(422, 'Keep the description under 20,000 characters.', 'requirements');
  const skills = parseSkillList(text(b.skills));
  for (const s of skills) {
    if (!validSource(s)) throw new HttpError(422, `"${s}" is not a skill source. Use owner/repo or owner/repo@skill.`, 'skills');
  }
  const dir = text(b.dir).trim() || slug(name);
  if (/[\0\r\n]/.test(dir)) throw new HttpError(422, 'That folder path is not valid.', 'dir');
  const run = createRun({ name, dir: path.resolve(dir), requirements, skills, global_skills: b.global_skills === true });
  startEngine(run.id);
  json(res, 201, { id: run.id });
}

async function answerFromBody(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  const b = await readBody(req);
  const qid = text(b.question);
  const answer = text(b.answer);
  if (!/^q-\d+$/.test(qid)) throw new HttpError(422, 'Pick a question to answer.');
  if (!answer.trim()) throw new HttpError(422, 'Type a number or an answer.', 'answer');
  if (answer.length > 4000) throw new HttpError(422, 'Keep the answer under 4,000 characters.', 'answer');
  try {
    store.answer(id, qid, answer, 'web');
  } catch (e) {
    const msg = (e as Error).message;
    const status = /already answered/.test(msg) ? 409 : /^No question/.test(msg) ? 404 : 422;
    throw new HttpError(status, msg, 'answer');
  }
  json(res, 201, { answered: qid });
}

async function skillSearch(res: ServerResponse, q: string): Promise<void> {
  if (!/^[\w .@/:-]{2,80}$/.test(q)) throw new HttpError(422, 'Type at least 2 letters or numbers.');
  const found = await findSkills(q, process.cwd());
  const skills = found.map((line) => {
    const m = /^(\S+) \((.+) installs\)$/.exec(line);
    return m ? { source: m[1], installs: m[2] } : { source: line, installs: '' };
  });
  json(res, 200, { skills });
}

async function pickFolder(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  try {
    json(res, 200, { path: await chooseFolder(text(body.path)) });
  } catch (e) {
    throw new HttpError(422, (e as Error).message, 'dir');
  }
}

function deleteRun(res: ServerResponse, id: string): void {
  try {
    store.removeRun(id);
  } catch (e) {
    const msg = (e as Error).message;
    throw new HttpError(/not running/.test(msg) ? 409 : 422, msg);
  }
  res.writeHead(204);
  res.end();
}

function stopRun(res: ServerResponse, id: string): void {
  const s = store.loadState(id);
  if (!store.isRunning(s) || !s.pid) return json(res, 409, { error: `${id} is not running.` });
  process.kill(s.pid, 'SIGINT');
  json(res, 202, { stopping: id });
}

function resumeRun(res: ServerResponse, id: string): void {
  const s = store.loadState(id);
  if (s.stage === 'done') return json(res, 409, { error: `${id} is finished.` });
  if (store.isRunning(s)) return json(res, 409, { error: `${id} is already running.` });
  startEngine(id);
  json(res, 202, { started: id });
}

function settings(res: ServerResponse): void {
  const picked = modelOverrides();
  const agents = ROLES.map((role) => ({ role, model: picked[role] ?? '', default: defaultModel(role) }));
  json(res, 200, { models: MODELS, agents });
}

async function saveSettings(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const b = await readBody(req);
  const asked = b.agents && typeof b.agents === 'object' && !Array.isArray(b.agents) ? (b.agents as Record<string, unknown>) : {};
  const next: Partial<Record<Role, string>> = { ...modelOverrides() };
  for (const role of ROLES) {
    if (!(role in asked)) continue;
    const m = text(asked[role]);
    if (m && !MODELS.includes(m)) throw new HttpError(422, `${m} is not a model orcs can use.`, role);
    if (m) next[role] = m;
    else delete next[role];
  }
  saveModelOverrides(next);
  settings(res);
}

export async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? 'GET';
  const p = url.pathname;

  if (method === 'GET' && p === '/api/runs') return json(res, 200, { runs: runSummaries() });
  if (method === 'POST' && p === '/api/runs') return createFromBody(req, res).then(() => undefined);
  if (method === 'GET' && p === '/api/folder') return json(res, 200, { dir: projectDir(url.searchParams.get('dir') ?? '', url.searchParams.get('name') ?? '') });
  if (method === 'GET' && p === '/api/dirs') return listDirs(res, url.searchParams.get('path') ?? '');
  if (method === 'POST' && p === '/api/pick-folder') return pickFolder(req, res);
  if (method === 'GET' && p === '/api/skills') return skillSearch(res, url.searchParams.get('q') ?? '');
  if (method === 'GET' && p === '/api/settings') return settings(res);
  if (method === 'PUT' && p === '/api/settings') return saveSettings(req, res);

  const m = RUN_PATH.exec(p);
  if (!m) return json(res, 404, { error: 'Not found.' });
  const id = m[1];
  const rest = m[2] ?? '';
  requireRun(id);

  if (method === 'GET' && rest === '') return json(res, 200, { ...runView(id), events: runEvents(id) });
  if (method === 'GET' && rest === 'stream') return streamRun(req, res, id, Number(url.searchParams.get('after') ?? 0));
  if (method === 'GET' && rest === 'requirement') return json(res, 200, store.readJsonIf(store.runFile(id, 'requirement.json')) ?? null);
  if (method === 'GET' && rest === 'architecture') return json(res, 200, store.readJsonIf(store.runFile(id, 'architecture.json')) ?? null);
  if (method === 'GET' && rest === 'bugs') return json(res, 200, store.readJsonIf(store.runFile(id, 'bugs.json')) ?? null);
  if (method === 'GET' && rest === 'report') return json(res, 200, reportData(id));
  if (method === 'POST' && rest === 'answers') return answerFromBody(req, res, id);
  if (method === 'DELETE' && rest === '') return deleteRun(res, id);
  if (method === 'POST' && rest === 'stop') return stopRun(res, id);
  if (method === 'POST' && rest === 'resume') return resumeRun(res, id);
  return json(res, 404, { error: 'Not found.' });
}
