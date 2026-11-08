#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import * as readline from 'node:readline/promises';
import type { Architecture, BugReport, OrcsEvent, Question, State, Usage } from './types.ts';
import { killChildren } from './engine/git.ts';
import { reportData } from './engine/report.ts';
import { createRun, runEngine } from './engine/run.ts';
import { history } from './engine/score.ts';
import { findSkills, isSource, parseSkillList } from './engine/skills.ts';
import * as store from './engine/store.ts';
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
  '',
  'Options for orcs new: --name, --req <text or file>, --skills <list>,',
  '  --global-skills yes|no, --dir <project folder>',
];

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
      flags[k] = v ?? argv[++i] ?? '';
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
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';

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
  let raw = flags.skills;
  if (raw === undefined) {
    out('Skills are installed for this project only. Skills can run code, so use sources you trust.');
    raw = await ask('AI skills you want (owner/repo@skill, comma separated, or blank): ');
  }
  const skills: string[] = [];
  for (const item of parseSkillList(raw)) {
    if (isSource(item)) {
      skills.push(item);
      continue;
    }
    out(`Looking up "${item}"...`);
    const found = await findSkills(item, process.cwd());
    if (!found.length || !rl) {
      out(found.length ? `Skipped "${item}". Name a source like ${found[0].split(' ')[0]}.` : `No skill found for "${item}". Skipped.`);
      continue;
    }
    found.forEach((f, i) => out(`  [${i + 1}] ${f}`));
    out(`  [${found.length + 1}] Skip`);
    const n = Number(await ask('Pick one: '));
    if (n >= 1 && n <= found.length) skills.push(found[n - 1].split(' ')[0]);
  }
  let global = flags['global-skills'];
  if (global === undefined) {
    out('Use your global skills too? This adds about 2k tokens to every agent turn, plus any skill an agent loads.');
    out(['  [1] No, project skills only (recommended)', '  [2] Yes']);
    global = (await ask('Pick one: ')) === '2' ? 'yes' : 'no';
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
    const lines = view.progress(store.loadState(this.id), usageOf(this.id), store.pending(this.id).length);
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
      return;
    }
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
    default: out(HELP);
  }
}

main().catch((e: Error) => {
  out(e.message);
  process.exit(1);
});
