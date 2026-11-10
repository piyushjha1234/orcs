#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as readline from 'node:readline/promises';
import type { Architecture, BugReport, OrcsEvent, Question, State, Usage } from './types.ts';
import { killChildren } from './engine/git.ts';
import { reportData } from './engine/report.ts';
import { createRun, runEngine } from './engine/run.ts';
import { history } from './engine/score.ts';
import { findSkills, isSource, parseSkillAnswer } from './engine/skills.ts';
import { slug } from './engine/intake.ts';
import * as store from './engine/store.ts';
import { serve } from './server/http.ts';
import { lanAddresses } from './server/auth.ts';
import { terminalQr } from './server/qr.ts';
import * as view from './view.ts';

const HELP = [
  'Orcs delivers a project with four AI agents.',
  '',
  '  orcs new                          start a project',
  '  orcs resume [id]                  continue a stopped run',
  '  orcs status [id]                  see progress and what needs you',
  '  orcs answer <id> <question> <choice>   answer from any terminal',
  '  orcs list                         list all runs',
  '  orcs bugs [id] [bug]              show the bug list or one bug',
  '  orcs report [id]                  show tokens, cost and score',
  '  orcs ui [--port 4477] [--host 127.0.0.1] [--open] [--shortcut]   open the orcs.ai web app',
  '',
  'Options for orcs new: --name, --req <text or file>, --skills <list>,',
  '  --global-skills yes|no, --dir <project folder>',
];

// Flags that take no value, so the word after them is not swallowed.
const SWITCHES = new Set(['open', 'shortcut']);

const out = (lines: string[] | string): void => {
  process.stdout.write((Array.isArray(lines) ? lines.join('\n') : lines) + '\n');
};

function parse(argv: string[]): { cmd: string; pos: string[]; flags: Record<string, string> } {
  const pos: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      flags[k] = SWITCHES.has(k) ? 'yes' : (v ?? argv[++i] ?? '');
    } else pos.push(a);
  }
  return { cmd: pos.shift() ?? 'help', pos, flags };
}

function latest(id?: string): string {
  const pick = id ?? store.listRunIds().at(-1);
  if (!pick) throw new Error('No runs yet. Start one with: orcs new');
  return pick;
}

const usageOf = (id: string) => store.readLines<Usage>(store.runFile(id, 'usage.jsonl'));

async function cmdNew(flags: Record<string, string>): Promise<void> {
  const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  const ask = async (q: string) => (rl ? (await rl.question(q)).trim() : '');
  const need = async (q: string, flag: string) => {
    let v = flags[flag] ?? '';
    while (!v.trim()) {
      if (!rl) throw new Error(`Missing --${flag}.`);
      v = await ask(q);
    }
    return v.trim();
  };
  const name = await need('Project name: ', 'name');
  let requirements = await need('Requirements (type them, or give a file path): ', 'req');
  if (fs.existsSync(requirements) && fs.statSync(requirements).isFile()) requirements = fs.readFileSync(requirements, 'utf8');
  let raw = flags.skills ?? '';
  let global = flags['global-skills'];
  if (flags.skills === undefined && rl) {
    out('Skills are optional, and they are installed for this project only. Name sources you trust, like owner/repo or owner/repo@skill, separated by commas. Add the word global if agents should also use your global skills. That adds about 2k tokens to every agent turn. Press enter to skip. Skills can run code, so use sources you trust.');
    raw = await ask('Skills: ');
  }
  const parsed = parseSkillAnswer(raw);
  if (global === undefined) global = parsed.global ? 'yes' : 'no';
  const skills: string[] = [];
  for (const item of parsed.items) {
    if (isSource(item)) {
      skills.push(item);
      continue;
    }
    out(`Looking up "${item}".`);
    const found = await findSkills(item, process.cwd());
    const source = found[0]?.split(' ')[0];
    if (!source) out(`No skill found for "${item}". Skipped.`);
    else {
      skills.push(source);
      out(`Using ${source} for "${item}".`);
    }
  }
  rl?.close();
  const dir = path.resolve(flags.dir ?? slug(name));
  const s = createRun({ name, dir, requirements, skills, global_skills: global === 'yes' });
  out(`Created ${s.id} in ${s.project}.`);
  await live(s.id);
}

class Screen {
  private footer = 0;
  private prompting: string | null = null;
  private abort?: AbortController;
  private queued: string[] = [];
  private shown = new Set<string>();
  private timer?: NodeJS.Timeout;
  private frame = 0;
  private beat = 0;
  private last = '';
  private rl?: readline.Interface;
  private id: string;
  private interactive: boolean;

  constructor(id: string, interactive: boolean) {
    this.id = id;
    this.interactive = interactive;
  }

  start(onStop: () => void): void {
    store.bus.on('event', this.onEvent);
    if (this.interactive) {
      this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      this.rl.on('SIGINT', onStop);
    }
    this.timer = setInterval(() => this.tick(), 1000);
    this.tick();
  }

  stop(): void {
    clearInterval(this.timer);
    store.bus.off('event', this.onEvent);
    this.abort?.abort();
    this.rl?.close();
    this.clear();
    this.flush();
  }

  private onEvent = (e: OrcsEvent) => {
    if (this.prompting) this.queued.push(`· ${e.text}`);
    else {
      this.clear();
      out(`· ${e.text}`);
      this.draw(true);
    }
  };

  private flush(): void {
    if (this.queued.length) out(this.queued.splice(0));
  }

  private clear(): void {
    if (this.footer) process.stdout.write(`\x1b[${this.footer}A\x1b[0J`);
    this.footer = 0;
  }

  private draw(force = false): void {
    if (!this.interactive || this.prompting) return;
    const lines = view.progress(store.loadState(this.id), usageOf(this.id), store.pending(this.id).length, this.frame);
    const text = lines.join('\n');
    if (!force && text === this.last && this.footer) return;
    this.clear();
    out(text);
    this.last = text;
    this.footer = lines.length;
  }

  private tick(): void {
    const waiting = store.pending(this.id);
    if (this.prompting && !waiting.some((q) => q.id === this.prompting)) this.abort?.abort();
    if (!this.interactive) {
      for (const q of waiting) {
        if (this.shown.has(q.id)) continue;
        this.shown.add(q.id);
        out([...view.questionView(q), `  Answer with: orcs answer ${this.id} ${q.id} <choice>`]);
      }
      const s = store.loadState(this.id);
      const now = Date.now();
      if (s.status === 'running' && now - this.beat >= 10_000) {
        this.beat = now;
        out(`· ${view.STAGE[s.stage]} · ${view.elapsedClock(s.created_at)}`);
      }
      return;
    }
    this.frame++;
    if (!this.prompting && waiting.length) void this.prompt(waiting[0]);
    else this.draw();
  }

  private async prompt(q: Question): Promise<void> {
    this.clear();
    this.prompting = q.id;
    out(['', ...view.questionView(q)]);
    for (;;) {
      this.abort = new AbortController();
      try {
        const raw = await this.rl!.question('> ', { signal: this.abort.signal });
        const a = store.answer(this.id, q.id, raw, 'cli');
        out(`  Answer: ${store.answerText(q, a)}`);
        break;
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          if (store.answers(this.id).has(q.id)) out('  Answered from another terminal.');
          break;
        }
        out(`  ${(e as Error).message}`);
      }
    }
    out('');
    this.prompting = null;
    this.flush();
    this.draw(true);
  }
}

function markStopped(id: string, why: string): void {
  const s = store.loadState(id);
  if (s.pid === process.pid) {
    s.status = 'stopped';
    s.error = why;
    delete s.pid;
    store.saveState(s);
  }
}

async function live(id: string): Promise<void> {
  const screen = new Screen(id, !!(process.stdin.isTTY && process.stdout.isTTY));
  const onStop = () => {
    screen.stop();
    killChildren();
    markStopped(id, 'You pressed Ctrl-C.');
    out(`Stopped. Continue with: orcs resume ${id}`);
    process.exit(130);
  };
  process.on('SIGINT', onStop);
  screen.start(onStop);
  const s = await runEngine(id);
  screen.stop();
  out(view.progress(s, usageOf(id), 0));
  if (s.status === 'done') out(`Report: ${store.runFile(id, 'report.md')}\nSee it here with: orcs report ${id}`);
  else out(`Continue with: orcs resume ${id}`);
  process.exit(s.status === 'done' ? 0 : 1);
}

function cmdStatus(id?: string): void {
  const rid = latest(id);
  const s = store.loadState(rid);
  const running = store.isRunning(s);
  if (!running && s.status === 'running') {
    s.status = 'stopped';
    s.error = 'Orcs is not running for this project.';
  }
  const waiting = store.pending(rid);
  out(view.progress(s, usageOf(rid), waiting.length));
  for (const q of waiting) out(['', ...view.questionView(q), `  Answer with: orcs answer ${rid} ${q.id} <choice>`]);
  if (!running && s.stage !== 'done') out(`\nNot running. Continue with: orcs resume ${rid}`);
}

function cmdAnswer(pos: string[]): void {
  const [id, qid, ...rest] = pos;
  if (!id || !qid || !rest.length) throw new Error('Use: orcs answer <id> <question> <choice>');
  const a = store.answer(id, qid, rest.join(' '), 'cli');
  const q = store.questions(id).find((x) => x.id === qid)!;
  out(`Answered ${qid}: ${store.answerText(q, a)}`);
  if (!store.isRunning(store.loadState(id))) out(`Orcs is not running for ${id}. Continue with: orcs resume ${id}`);
}

function cmdList(): void {
  const states = store.listRunIds().map((id) => store.loadState(id));
  out(view.runList(states, new Map(history().map((r) => [r.id, r.score]))));
}

function cmdBugs(pos: string[]): void {
  const id = latest(pos.find((p) => p.startsWith('orcs-')));
  const bug = pos.find((p) => p.startsWith('bug-'));
  const report = store.readJsonIf<BugReport>(store.runFile(id, 'bugs.json'));
  const arch = store.readJsonIf<Architecture>(store.runFile(id, 'architecture.json'));
  if (!report) return out(`No test results for ${id} yet.`);
  if (bug) {
    const b = report.bugs.find((x) => x.id === bug);
    return out(b ? view.bugDetail(b, arch) : `No ${bug} in ${id}.`);
  }
  out([...view.bugLines(report, arch), '', `Full list: ${store.runFile(id, 'bug-report.csv')}`]);
}

function cmdReport(id?: string): void {
  const rid = latest(id);
  out(view.reportView(reportData(rid)));
  const file = store.runFile(rid, 'report.md');
  if (fs.existsSync(file)) out(`\nSaved: ${file}`);
}

function desktopShortcut(port = 4477): string {
  const desktop = path.join(os.homedir(), 'Desktop');
  fs.mkdirSync(desktop, { recursive: true });
  fs.rmSync(path.join(desktop, 'Orcs.webloc'), { force: true });
  const file = path.join(desktop, 'Orcs.command');
  const cli = path.resolve(import.meta.dirname, 'cli.ts');
  const url = `http://127.0.0.1:${port}/`;
  const script = `#!/bin/bash
# Double-click starts orcs.ai in this window, then opens it in the browser.
set -e
NODE=${JSON.stringify(process.execPath)}
if [[ ! -x "$NODE" ]]; then
  NODE="$(command -v node || true)"
fi
if [[ ! -x "$NODE" ]]; then
  echo "Node was not found. Install Node 22, then try again."
  echo "Press return to close."
  read -r
  exit 1
fi
if curl -fsS -o /dev/null --max-time 2 ${JSON.stringify(url)}; then
  open ${JSON.stringify(url)}
  echo "orcs.ai is already running."
  echo "Opened ${url}"
  echo "Press return to close."
  read -r
  exit 0
fi
exec "$NODE" ${JSON.stringify(cli)} ui --open --port ${port}
`;
  fs.writeFileSync(file, script, { mode: 0o755 });
  fs.chmodSync(file, 0o755);
  return file;
}

async function cmdUi(flags: Record<string, string>): Promise<void> {
  const port = Number(flags.port || 4477);
  if (flags.shortcut === 'yes') out(`Desktop shortcut: ${desktopShortcut(Number.isInteger(port) ? port : 4477)}`);
  const host = flags.host || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Use a port from 1 to 65535.');
  let app: Awaited<ReturnType<typeof serve>>;
  try {
    app = await serve({ host, port });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (flags.open === 'yes' && code === 'EADDRINUSE') {
      const url = `http://127.0.0.1:${port}/`;
      const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
      const { spawn } = await import('node:child_process');
      spawn(opener, [url], { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
      out(`orcs.ai is already running.\n  Opened: ${url}`);
      return;
    }
    throw e;
  }
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  const lines = ['orcs.ai is running.', `  Open: ${app.url}`, '  Keep this link private. Anyone with it can see and answer your runs.'];
  if (!loopback) {
    const lan = lanAddresses()[0] ?? host;
    const phone = `http://${lan}:${app.port}/?token=${app.token}`;
    lines.push('', `  Phone, same network: ${phone}`, '', ...terminalQr(phone).split('\n').map((l: string) => `  ${l}`));
  }
  lines.push('', 'Stop with Ctrl-C.');
  out(lines);
  if (flags.open === 'yes') {
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const { spawn } = await import('node:child_process');
    spawn(opener, [app.url], { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
  }
  const stop = () => {
    void app.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

async function cmdResume(id?: string): Promise<void> {
  const rid = latest(id);
  const s: State = store.loadState(rid);
  if (s.stage === 'done') return out(`${rid} is finished. See it with: orcs report ${rid}`);
  if (store.isRunning(s)) return out(`${rid} is already running. Watch it with: orcs status ${rid}`);
  await live(rid);
}

async function main(): Promise<void> {
  const { cmd, pos, flags } = parse(process.argv.slice(2));
  switch (cmd) {
    case 'new': return cmdNew(flags);
    case 'resume': return cmdResume(pos[0]);
    case 'status': return cmdStatus(pos[0]);
    case 'answer': return cmdAnswer(pos);
    case 'list': return cmdList();
    case 'bugs': return cmdBugs(pos);
    case 'report': return cmdReport(pos[0]);
    case 'ui': return cmdUi(flags);
    default: out(HELP);
  }
}

main().catch((e: Error) => {
  out(e.message);
  process.exit(1);
});
