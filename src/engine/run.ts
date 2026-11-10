import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Architecture, Bug, BugReport, Decision, Intake, Question, Requirement, Stage, State, Task, TestPlan } from '../types.ts';
import { architectureSummary, brief, bugLines, requirementSummary } from '../view.ts';
import { callClaude, converse, loadAgent, nudge, send, StopRun, type ConverseOpts } from './agent.ts';
import { rememberMistake } from './lessons.ts';
import { ARCHITECTURE_FIELDS, checkArchitecture, checkBugs, checkRequirement, checkTestPlan, inside, outOfScope, overlaps, pick, readyTasks, REQUIREMENT_FIELDS } from './checks.ts';
import * as g from './git.ts';
import { writeReadme } from './readme.ts';
import { writeBugCsv, writeReport } from './report.ts';
import { ensureSeed, recordScore } from './score.ts';
import { globalSkillNames, installSkill, linkSkills, projectSkills, recommendations } from './skills.ts';
import * as store from './store.ts';

type Ask = Omit<Question, 'id' | 'created_at' | 'from'>;
type TaskInput = { task: Task } & Record<string, unknown>;

export function createRun(intake: Intake): State {
  ensureSeed();
  const id = store.nextRunId();
  const project = path.resolve(intake.dir);
  const { branch, base } = g.ensureRepo(project);
  g.excludeLocal(project, ['node_modules/', '.claude/skills', 'skills-lock.json']);
  const t = store.now();
  const s: State = {
    id, name: intake.name, project, branch, base, created_at: t, updated_at: t,
    stage: 'analyst', status: 'stopped', intake: { ...intake, dir: project },
    installed: [], skills: projectSkills(project).map((x) => x.name), security_review: false,
    decisions: {}, fix: [], test: null, intensity: null, round: 0,
    convos: {}, tasks: {}, approvals: {},
    counters: { rework: 0, scope_violations: 0, blockers: 0, contract_retries: 0 },
  };
  store.writeJson(store.runFile(id, 'intake.json'), s.intake);
  store.saveState(s);
  store.event(id, 'start', `Started ${id} for ${intake.name}.`);
  return s;
}

function next(s: State, stage: Stage): void {
  s.stage = stage;
  store.saveState(s);
}

async function decide(s: State, key: string, q: Ask): Promise<Decision> {
  const d = s.decisions[key];
  if (d && (d.choice !== undefined || d.text !== undefined)) return d;
  const qid = d?.q ?? store.ask(s.id, { from: 'orcs', ...q }).id;
  if (!d) {
    s.decisions[key] = { q: qid };
    store.saveState(s);
  }
  const a = await store.waitAnswer(s.id, qid);
  s.decisions[key] = { q: qid, ...(a.choice !== undefined ? { choice: a.choice } : {}), ...(a.text !== undefined ? { text: a.text } : {}) };
  store.saveState(s);
  return s.decisions[key];
}

function forget(s: State, ...keys: string[]): void {
  for (const k of keys) delete s.decisions[k];
  store.saveState(s);
}

function approved<T>(s: State, key: 'requirement' | 'architecture'): T {
  const file = store.runFile(s.id, `${key}.json`);
  if (s.approvals[key]?.sha256 !== store.sha256File(file)) throw new Error(`${key}.json changed after you approved it.`);
  return store.readJson<T>(file);
}

async function approve(s: State, key: 'requirement' | 'architecture', summary: () => string[], revise: (change: string) => Promise<void>): Promise<void> {
  const file = store.runFile(s.id, `${key}.json`);
  if (s.approvals[key]?.sha256 === store.sha256File(file)) return;
  const agent = key === 'requirement' ? 'analyst' : 'architect';
  for (;;) {
    const d = await decide(s, `approve-${key}`, { text: `Approve the ${key}?`, details: summary(), options: ['Approve', 'Change something'], recommended: 1, free_text: true });
    if (d.choice === 1) {
      s.approvals[key] = { file: path.basename(file), sha256: store.sha256File(file), at: store.now() };
      forget(s, `approve-${key}`);
      store.event(s.id, 'approved', `You approved the ${key}.`);
      return;
    }
    const change = d.text ?? (await decide(s, `change-${key}`, { text: `What should change in the ${key}?`, options: [], recommended: 0, free_text: true })).text ?? '';
    store.event(s.id, 'change', `Sent your change to the ${agent}.`);
    await revise(change);
    forget(s, `approve-${key}`, `change-${key}`);
  }
}

async function install(s: State, src: string): Promise<void> {
  store.event(s.id, 'skill', `Installing ${src} for this project.`);
  try {
    const names = await installSkill(s.project, src);
    store.event(s.id, 'skill', `Installed ${names.join(', ')}.`);
  } catch {
    const d = await decide(s, `install-${src}`, { text: `Could not install ${src}. What now?`, options: ['Skip it', 'Stop the run'], recommended: 1 });
    if (d.choice === 2) throw new StopRun(`Could not install ${src}.`);
  }
}

async function installRequested(s: State): Promise<void> {
  for (const src of s.intake.skills) {
    if (s.installed.includes(src)) continue;
    const name = src.includes('@') ? src.split('@').pop()! : '';
    if (!(s.intake.global_skills && name && globalSkillNames().includes(name))) await install(s, src);
    s.installed.push(src);
    store.saveState(s);
  }
}

async function analyst(s: State): Promise<void> {
  await installRequested(s);
  const file = store.runFile(s.id, 'requirement.json');
  const opts: ConverseOpts = {
    state: s, key: 'analyst', agent: 'analyst', role: 'analyst', from: 'analyst', cwd: s.project,
    first: JSON.stringify({ project: s.name, request: s.intake.requirements }),
    schemaName: 'requirement', check: checkRequirement,
  };
  if (!fs.existsSync(file)) {
    store.event(s.id, 'stage', 'Analyst is working on the requirement.');
    store.writeJson(file, pick(await converse(opts), REQUIREMENT_FIELDS));
    store.event(s.id, 'stage', 'The requirement is ready for your review.');
  }
  await approve(s, 'requirement', () => requirementSummary(store.readJson(file)), async (change) => {
    store.writeJson(file, pick(await send(opts, { change }), REQUIREMENT_FIELDS));
  });
  next(s, 'skills');
}

function hasSkill(s: State, r: ReturnType<typeof recommendations>[number]): boolean {
  if (r.kind === 'builtin') return s.security_review;
  return projectSkills(s.project).some((x) => x.name === r.name) || (s.intake.global_skills && globalSkillNames().includes(r.name));
}

function skillAsk(missing: ReturnType<typeof recommendations>): string {
  const bits = missing.map((r) => {
    const why = r.when === 'ui' ? 'the project has screens' : 'the project handles logins, personal data, payments or a public API';
    const name = r.kind === 'builtin' ? 'a security review' : r.name;
    return `${name} (${r.what}) because ${why}`;
  });
  const list = bits.length === 1 ? bits[0] : `${bits.slice(0, -1).join(', ')} and ${bits.at(-1)}`;
  return `Add ${list}? This stays on this project only.`;
}

async function skills(s: State): Promise<void> {
  const req = approved<Requirement>(s, 'requirement');
  const missing = recommendations(req).filter((r) => !hasSkill(s, r));
  if (missing.length) {
    const both = missing.some((r) => r.kind === 'install') && missing.some((r) => r.kind === 'builtin');
    const d = await decide(s, 'skills-recommend', {
      text: skillAsk(missing),
      options: both ? ['Add all', 'Only the security review', 'No'] : ['Yes', 'No'],
      recommended: 1,
    });
    const take = d.choice === 1 ? missing : d.choice === 2 && both ? missing.filter((r) => r.kind === 'builtin') : [];
    for (const r of take) {
      if (r.kind === 'builtin') {
        s.security_review = true;
        store.saveState(s);
        store.event(s.id, 'skill', 'Security review is on.');
      } else {
        await install(s, `${r.source}@${r.skill}`);
      }
    }
  }
  s.skills = projectSkills(s.project).map((x) => x.name);
  next(s, 'architect');
}

async function architect(s: State): Promise<void> {
  const req = approved<Requirement>(s, 'requirement');
  const file = store.runFile(s.id, 'architecture.json');
  const skillList = projectSkills(s.project);
  const opts: ConverseOpts = {
    state: s, key: 'architect', agent: 'architect', role: 'architect', from: 'architect', cwd: s.project,
    first: JSON.stringify({ project: s.name, requirement: req, project_skills: skillList }),
    schemaName: 'architecture', check: (out) => checkArchitecture(out, req, skillList.map((x) => x.name)),
  };
  if (!fs.existsSync(file)) {
    store.event(s.id, 'stage', 'Architect is designing the solution.');
    store.writeJson(file, pick(await converse(opts), ARCHITECTURE_FIELDS));
    store.event(s.id, 'stage', 'The architecture is ready for your review.');
  }
  await approve(s, 'architecture', () => architectureSummary(store.readJson(file)), async (change) => {
    store.writeJson(file, pick(await send(opts, { change }), ARCHITECTURE_FIELDS));
  });
  const arch = approved<Architecture>(s, 'architecture');
  for (const t of arch.tasks) {
    store.writeJson(store.runFile(s.id, `tasks/${t.id}.json`), {
      task: t, setup: arch.setup, stack: arch.stack, interfaces: arch.interfaces.filter((i) => t.interfaces.includes(i.id)),
    });
  }
  next(s, 'build');
}

let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn);
  chain = p.catch(() => undefined);
  return p;
}

interface Problem {
  gate: string;
  detail: string;
}

async function installIn(cwd: string, arch: Architecture): Promise<void> {
  if (!arch.setup.install.trim()) return;
  await g.sh(arch.setup.install, cwd);
  g.commitAll(cwd, 'orcs: install dependencies');
}

async function mergeCheck(s: State, t: Task, arch: Architecture, wt: string, base: string): Promise<Problem | null> {
  g.commitAll(wt, `${t.id}: ${t.title}`);
  const changed = g.changedFiles(wt, base);
  if (!changed.length) return { gate: 'change check', detail: 'No files changed. Build the task.' };
  const outside = outOfScope(changed, t.files);
  if (outside.length) {
    s.counters.scope_violations++;
    g.revertPaths(wt, base, outside);
    return { gate: 'scope check', detail: `These files are outside your task and were reverted: ${outside.join(', ')}. Finish without them, or ask a blocker question.` };
  }
  const test = await g.sh(t.test, wt);
  if (test.code !== 0) return { gate: 'task test', detail: g.excerpt(test.out) };
  return exclusive(async () => {
    const main = store.worktreeDir(s.id, 'main');
    g.resetHard(main, 'HEAD');
    const before = g.head(main);
    const m = g.merge(main, `orcs/${s.id}/${t.id}`, `orcs: merge ${t.id} ${t.title}`);
    if (!m.ok) return { gate: 'merge', detail: g.excerpt(m.out) };
    await installIn(main, arch);
    for (const [gate, cmd] of [['project build', arch.setup.commands.build], ['project tests', arch.setup.commands.test]] as const) {
      if (!cmd.trim()) continue;
      const r = await g.sh(cmd, main);
      if (r.code !== 0) {
        g.resetHard(main, before);
        return { gate, detail: g.excerpt(r.out) };
      }
    }
    return null;
  });
}

const signature = (p: Problem) => `${p.gate}\n${p.detail.split('\n').slice(-5).join('\n').replace(/\d+(\.\d+)?/g, '#')}`;

async function runTask(s: State, t: Task, arch: Architecture, input: TaskInput): Promise<void> {
  const ts = s.tasks[t.id];
  const wt = store.worktreeDir(s.id, t.id);
  const main = store.worktreeDir(s.id, 'main');
  ts.status = 'building';
  ts.started_at ??= store.now();
  delete ts.note;
  store.saveState(s);
  if (!fs.existsSync(path.join(wt, '.git'))) {
    g.addWorktree(s.project, wt, `orcs/${s.id}/${t.id}`, g.head(main));
    linkSkills(s.project, wt);
    store.event(s.id, 'task', `${t.id} started: ${t.title}.`, { task: t.id });
    await installIn(wt, arch);
    ts.base = g.head(wt);
    store.saveState(s);
  }
  ts.base ??= g.head(wt);
  const opts: ConverseOpts = {
    state: s, key: `dev:${t.id}`, agent: 'developer', role: 'developer', from: t.id, task: t.id, cwd: wt,
    first: JSON.stringify(input), schemaName: 'dev-result', model: ts.model,
    onAsk: () => {
      s.counters.blockers++;
      ts.status = 'blocked';
    },
    onAnswered: () => {
      ts.status = 'building';
    },
  };
  await converse(opts);
  for (;;) {
    ts.status = 'checking';
    store.saveState(s);
    const problem = await mergeCheck(s, t, arch, wt, ts.base);
    if (!problem) {
      ts.status = 'merged';
      ts.ended_at = store.now();
      store.saveState(s);
      store.event(s.id, 'merged', `${t.id} merged: ${t.title}.`, { task: t.id });
      return;
    }
    s.counters.rework++;
    ts.fails++;
    ts.status = 'fixing';
    ts.last_check = problem.gate;
    const c = s.convos[opts.key];
    const sig = signature(problem);
    c.repeats = sig === c.last_errors ? c.repeats + 1 : 0;
    c.last_errors = sig;
    store.event(s.id, 'rework', `${t.id} failed the ${problem.gate}. Sent back to fix.`, { task: t.id, gate: problem.gate });
    rememberMistake('developer', problem.gate, problem.detail);
    if (c.repeats >= 1) {
      await nudge(s, t.id, c, problem.detail);
      ts.model = c.model;
    }
    store.saveState(s);
    // A failed check stays with this developer. It does not reopen the architecture.
    await send(opts, { fix: { gate: problem.gate, output: problem.detail }, note: 'Fix this in the task. Do not ask for an architecture change.' });
  }
}

function runTasks(s: State, tasks: Task[], arch: Architecture): Promise<void> {
  const merged = new Set(Object.values(s.tasks).filter((t) => t.status === 'merged').map((t) => t.id));
  const busy = new Set<string>();
  const limit = Math.max(1, arch.developers);
  return new Promise((resolve, reject) => {
    let failed = false;
    const pump = () => {
      if (failed) return;
      for (const t of tasks) {
        const ts = s.tasks[t.id];
        if (ts.status !== 'waiting') continue;
        const need = t.deps.filter((d) => !merged.has(d));
        if (need.length) ts.note = `needs ${need.join(', ')}`;
        else delete ts.note;
      }
      for (const t of readyTasks(tasks, merged, busy)) {
        if (busy.size >= limit) break;
        busy.add(t.id);
        const input = store.readJson<TaskInput>(store.runFile(s.id, `tasks/${t.id}.json`));
        runTask(s, t, arch, input).then(
          () => {
            busy.delete(t.id);
            merged.add(t.id);
            pump();
          },
          (e) => {
            failed = true;
            reject(e);
          },
        );
      }
      store.saveState(s);
      if (!busy.size) {
        const left = tasks.filter((t) => !merged.has(t.id));
        if (left.length) reject(new Error(`These tasks cannot start: ${left.map((t) => t.id).join(', ')}.`));
        else resolve();
      }
    };
    pump();
  });
}

function testerView(arch: Architecture): Omit<Architecture, 'tasks' | 'developers'> {
  const { tasks: _tasks, developers: _developers, ...rest } = arch;
  return rest;
}

async function testChoice(s: State): Promise<void> {
  if (s.test !== null) return;
  const d = await decide(s, 'test', { text: 'Test this project?', options: ['Yes', 'Skip testing'], recommended: 1 });
  if (d.choice !== 1) {
    s.test = false;
    store.saveState(s);
    store.event(s.id, 'test', 'Testing is skipped.');
    return;
  }
  const i = await decide(s, 'intensity', { text: 'How hard should AI test it?', options: ['Low: fastest', 'Medium', 'High: slowest, most thorough'], recommended: 2 });
  s.intensity = (['low', 'medium', 'high'] as const)[(i.choice ?? 2) - 1];
  s.test = true;
  store.saveState(s);
  store.event(s.id, 'test', `Testing is on, at ${s.intensity} intensity.`);
}

async function testerPlan(s: State, req: Requirement, arch: Architecture): Promise<void> {
  await testChoice(s);
  const file = store.runFile(s.id, 'tests.json');
  if (!s.test || fs.existsSync(file)) return;
  const ts = (s.tasks.tester ??= { id: 'tester', title: 'test plan and tests', kind: 'plan', status: 'building', model: loadAgent('tester').model, fails: 0, started_at: store.now() });
  const wt = store.worktreeDir(s.id, 'tests');
  g.addWorktree(s.project, wt, `orcs/${s.id}/tests`, s.base);
  linkSkills(s.project, wt);
  store.event(s.id, 'stage', `Tester is planning ${s.intensity} intensity tests.`, { task: 'tester' });
  const opts: ConverseOpts = {
    state: s, key: 'tester:plan', agent: 'tester', role: 'tester', from: 'tester', task: 'tester', cwd: wt,
    first: JSON.stringify({ phase: 'plan', intensity: s.intensity, requirement: req, architecture: testerView(arch) }),
    schemaName: 'test-plan', check: (out) => checkTestPlan(out, req, arch, s.intensity!),
  };
  let out = await converse(opts);
  for (;;) {
    g.commitAll(wt, 'orcs: tests');
    const outside = g.changedFiles(wt, s.base).filter((f) => !inside(f, arch.setup.tests_dir));
    if (!outside.length) break;
    s.counters.scope_violations++;
    g.revertPaths(wt, s.base, outside);
    store.event(s.id, 'rework', `Tester wrote files outside ${arch.setup.tests_dir}. Sent back.`, { task: 'tester', gate: 'scope check' });
    rememberMistake('tester', 'scope check', `Write only inside ${arch.setup.tests_dir}. These files were reverted: ${outside.join(', ')}.`);
    out = await send(opts, { fix: [`Write only inside ${arch.setup.tests_dir}. These files were reverted: ${outside.join(', ')}.`] });
  }
  store.writeJson(file, { cases: out.cases, files: out.files });
  ts.status = 'merged';
  ts.ended_at = store.now();
  store.saveState(s);
  store.event(s.id, 'stage', `Tester wrote ${(out.cases as unknown[]).length} test cases.`, { task: 'tester' });
}

async function build(s: State): Promise<void> {
  const req = approved<Requirement>(s, 'requirement');
  const arch = approved<Architecture>(s, 'architecture');
  const main = store.worktreeDir(s.id, 'main');
  g.addWorktree(s.project, main, `orcs/${s.id}/main`, s.base);
  linkSkills(s.project, main);
  g.excludeLocal(s.project, arch.setup.ignore);
  const model = loadAgent('developer').model;
  for (const t of arch.tasks) s.tasks[t.id] ??= { id: t.id, title: t.title, kind: 'build', status: 'waiting', model, fails: 0 };
  store.saveState(s);
  if (arch.tasks.some((t) => s.tasks[t.id].status !== 'merged')) {
    store.event(s.id, 'stage', `Build started: ${arch.tasks.length} tasks, up to ${arch.developers} at once.`);
  }
  await Promise.all([runTasks(s, arch.tasks, arch), testerPlan(s, req, arch)]);
  store.event(s.id, 'stage', 'Build is done. Every task is merged.');
  if (s.test && !s.round) s.round = 1;
  next(s, s.test ? 'test' : 'accept');
}

async function securityReview(s: State, req: Requirement, arch: Architecture): Promise<Bug[]> {
  const cache = store.runFile(s.id, 'security.json');
  const hit = store.readJsonIf<Bug[]>(cache);
  if (hit) return hit;
  const dir = store.worktreeDir(s.id, 'review');
  g.reviewClone(s.project, dir, `orcs/${s.id}/main`);
  store.event(s.id, 'test', 'Security review started.', { task: 'security' });
  const out = (await callClaude({ state: s, agent: 'security', role: 'tester', task: 'security', cwd: dir, prompt: '/security-review', schemaName: 'bugs', session: randomUUID(), resume: false })) as { bugs?: Bug[] };
  const brs = new Set(req.brs.map((b) => b.id));
  const envs = new Set(arch.test_scope.matrix.map((e) => e.id));
  const found = (out.bugs ?? []).map((b) => ({ ...b, type: 'security', status: 'open' as const, br: brs.has(b.br) ? b.br : 'none', env: envs.has(b.env) ? b.env : 'none' }));
  store.writeJson(cache, found);
  store.event(s.id, 'test', `Security review found ${found.length} issue${found.length === 1 ? '' : 's'}.`, { task: 'security' });
  return found;
}

const RISK = { high: 0, medium: 1, low: 2 };
const num = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? 0);

async function test(s: State): Promise<void> {
  const req = approved<Requirement>(s, 'requirement');
  const arch = approved<Architecture>(s, 'architecture');
  const file = store.runFile(s.id, 'bugs.json');
  const prev = store.readJsonIf<BugReport>(file);
  if (prev?.round === s.round) {
    next(s, 'bugs');
    return;
  }
  const plan = store.readJson<TestPlan>(store.runFile(s.id, 'tests.json'));
  const main = store.worktreeDir(s.id, 'main');
  const testsBranch = `orcs/${s.id}/tests`;
  g.resetHard(main, 'HEAD');
  if (!g.isAncestor(main, testsBranch, 'HEAD')) {
    const m = g.merge(main, testsBranch, 'orcs: add tests');
    if (!m.ok) throw new Error(`Could not add the tests: ${brief(m.out, 2)}`);
  }
  const ts = s.tasks.tester;
  if (ts) {
    ts.status = 'building';
    ts.title = `test round ${s.round}`;
    ts.started_at = store.now();
  }
  store.event(s.id, 'stage', `Test round ${s.round} started.`, { task: 'tester' });
  await installIn(main, arch);
  const acc = await g.sh(arch.setup.commands.acceptance, main);
  store.event(s.id, 'test', `Acceptance tests ${acc.code === 0 ? 'passed' : 'found failures'}.`, { task: 'tester' });
  const security = s.security_review && s.round === 1 ? await securityReview(s, req, arch) : [];
  const previous = prev?.bugs ?? [];
  const verify = previous.filter((b) => b.status === 'open' && s.fix.includes(b.id));
  const opts: ConverseOpts = {
    state: s, key: `tester:run:${s.round}`, agent: 'tester', role: 'tester', from: 'tester', task: 'tester', cwd: main,
    first: JSON.stringify({
      phase: 'execute', round: s.round, intensity: s.intensity, requirement: req, architecture: testerView(arch), plan,
      acceptance: { exit_code: acc.code, output: g.excerpt(acc.out, 80) },
      verify_bugs: verify,
    }),
    schemaName: 'bugs', check: (out) => checkBugs(out, req, arch),
  };
  const out = await converse(opts);
  let seq = Math.max(0, ...previous.map((b) => num(b.id)));
  const toVerify = new Set(verify.map((b) => b.id));
  const result: Bug[] = [];
  for (const b of out.bugs as Bug[]) {
    if (toVerify.delete(b.id)) result.push(b);
    else result.push({ ...b, id: `bug-${++seq}`, status: 'open' });
  }
  for (const b of verify) if (toVerify.has(b.id)) result.push(b);
  for (const b of previous) if (!verify.includes(b)) result.push(b);
  for (const b of security) result.push({ ...b, id: `bug-${++seq}` });
  result.sort((a, b) => RISK[a.risk] - RISK[b.risk] || num(a.id) - num(b.id));
  const report: BugReport = { round: s.round, results: out.results as BugReport['results'], bugs: result };
  store.writeJson(file, report);
  writeBugCsv(s, result, arch);
  if (ts) {
    ts.status = 'merged';
    ts.ended_at = store.now();
  }
  const open = result.filter((b) => b.status === 'open').length;
  store.event(s.id, 'test', `Test round ${s.round} is done: ${open} open bug${open === 1 ? '' : 's'}.`, { task: 'tester' });
  next(s, 'bugs');
}

async function bugs(s: State): Promise<void> {
  const arch = approved<Architecture>(s, 'architecture');
  const file = store.runFile(s.id, 'bugs.json');
  const report = store.readJson<BugReport>(file);
  const open = report.bugs.filter((b) => b.status === 'open');
  const key = `bugs-${s.round}`;
  const accept = () => {
    s.approvals[key] = { file: 'bugs.json', sha256: store.sha256File(file), at: store.now() };
    store.event(s.id, 'bugs', 'You accepted the delivery.');
    next(s, 'rating');
  };
  if (!open.length) {
    const d = await decide(s, key, { text: 'No open bugs. Accept the delivery?', details: bugLines(report, arch), options: ['Accept', 'Stop here'], recommended: 1 });
    if (d.choice === 2) throw new StopRun('You stopped after testing.');
    accept();
    return;
  }
  const serious = open.filter((b) => b.risk !== 'low');
  const d = await decide(s, key, {
    text: 'What next?',
    details: [...bugLines(report, arch), `Details: orcs bugs ${s.id} <bug>`],
    options: ['Fix high and medium', 'Fix all', 'Pick bugs', 'Accept as is'],
    recommended: serious.length ? 1 : 4,
    free_text: true,
  });
  let pick: string[] = [];
  if (d.choice === 1) pick = serious.map((b) => b.id);
  else if (d.choice === 2) pick = open.map((b) => b.id);
  else if (d.choice === 3 || d.text) {
    const text = (d.text ?? (await decide(s, `${key}-pick`, { text: 'Which bugs? For example: bug-1, bug-3', options: [], recommended: 0, free_text: true })).text ?? '').toLowerCase();
    pick = open.filter((b) => new RegExp(`\\b${b.id}\\b`).test(text)).map((b) => b.id);
  }
  if (!pick.length) {
    accept();
    return;
  }
  s.approvals[key] = { file: 'bugs.json', sha256: store.sha256File(file), at: store.now() };
  s.fix = pick;
  store.event(s.id, 'bugs', `Fixing ${pick.length} bug${pick.length === 1 ? '' : 's'}: ${pick.join(', ')}.`);
  next(s, 'fix');
}

async function fix(s: State): Promise<void> {
  const arch = approved<Architecture>(s, 'architecture');
  const report = store.readJson<BugReport>(store.runFile(s.id, 'bugs.json'));
  const read = (id: string) => store.readJson<TaskInput>(store.runFile(s.id, `tasks/${id}.json`)).task;
  let pending = Object.values(s.tasks).filter((t) => t.kind === 'fix' && t.status !== 'merged').map((t) => read(t.id));
  if (!pending.length) {
    let n = Object.values(s.tasks).filter((t) => t.kind === 'fix').length;
    const model = loadAgent('developer').model;
    for (const id of s.fix) {
      const bug = report.bugs.find((b) => b.id === id);
      if (!bug) continue;
      let owners = arch.tasks.filter((t) => (bug.br !== 'none' && t.brs.includes(bug.br)) || (bug.file && t.files.some((f) => overlaps(f, bug.file) || inside(bug.file, f))));
      if (!owners.length) owners = arch.tasks;
      const files = [...new Set(owners.flatMap((t) => t.files))];
      const task: Task = {
        id: `fix-${++n}`,
        title: `fix ${bug.id}: ${bug.title}`,
        brs: bug.br === 'none' ? [] : [bug.br],
        files,
        deps: pending.filter((p) => p.files.some((f) => files.some((x) => overlaps(f, x)))).map((p) => p.id),
        steps: [],
        interfaces: [...new Set(owners.flatMap((t) => t.interfaces))],
        facts: [],
        ac: [bug.expected],
        test: [...new Set(owners.map((t) => t.test))].join(' && '),
        skills: [...new Set(owners.flatMap((t) => t.skills))],
      };
      pending.push(task);
      store.writeJson(store.runFile(s.id, `tasks/${task.id}.json`), {
        task, bug, setup: arch.setup, stack: arch.stack, interfaces: arch.interfaces.filter((i) => task.interfaces.includes(i.id)),
      });
      s.tasks[task.id] = { id: task.id, title: task.title, kind: 'fix', status: 'waiting', model, fails: 0 };
    }
    store.saveState(s);
  }
  await runTasks(s, pending, arch);
  s.round++;
  next(s, 'test');
}

async function accept(s: State): Promise<void> {
  const d = await decide(s, 'accept', {
    text: 'Build is done. Accept the delivery?',
    details: [`Testing was skipped. The work is on branch orcs/${s.id}/main.`],
    options: ['Accept', 'Stop here'],
    recommended: 1,
  });
  if (d.choice === 2) throw new StopRun('You stopped before acceptance.');
  next(s, 'rating');
}

async function rating(s: State): Promise<void> {
  for (;;) {
    const d = await decide(s, 'rating', { text: 'Rate this delivery from 0 to 10.', options: [], recommended: 0, free_text: true });
    const n = Number(d.text ?? d.choice);
    if (Number.isInteger(n) && n >= 0 && n <= 10) {
      s.rating = n;
      break;
    }
    forget(s, 'rating');
  }
  next(s, 'finish');
}

async function finish(s: State): Promise<void> {
  const req = approved<Requirement>(s, 'requirement');
  const arch = approved<Architecture>(s, 'architecture');
  const main = store.worktreeDir(s.id, 'main');
  const branch = `orcs/${s.id}/main`;
  g.resetHard(main, 'HEAD');
  writeReadme(main, s.name, req, arch);
  g.commitAll(main, 'orcs: readme');
  store.event(s.id, 'finish', 'Readme written.');
  if (g.currentBranch(s.project) !== s.branch) {
    store.event(s.id, 'finish', `Your project is not on ${s.branch}. The work stays on branch ${branch}.`);
  } else {
    const m = g.merge(s.project, branch, `orcs: ${s.name} (${s.id})`);
    store.event(s.id, 'finish', m.ok ? `Merged into ${s.branch}.` : `Could not merge into ${s.branch}. The work stays on branch ${branch}.`);
  }
  s.ended_at = store.now();
  store.saveState(s);
  const rec = recordScore(s);
  const report = writeReport(s.id);
  const dir = store.worktreeDir(s.id);
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'review') fs.rmSync(path.join(dir, name), { recursive: true, force: true });
      else g.removeWorktree(s.project, path.join(dir, name));
    }
  }
  store.event(s.id, 'done', `Done. Score ${rec.score}. Report: ${report}`);
  next(s, 'done');
}

const STAGES: Record<Exclude<Stage, 'done'>, (s: State) => Promise<void>> = {
  analyst, skills, architect, build, test, bugs, fix, accept, rating, finish,
};

export async function runEngine(id: string): Promise<State> {
  const s = store.loadState(id);
  if (s.stage === 'done') return s;
  store.lock(s);
  s.status = 'running';
  delete s.error;
  store.saveState(s);
  try {
    const stage = (): Stage => s.stage;
    for (let st = stage(); st !== 'done'; st = stage()) await STAGES[st](s);
    s.status = 'done';
  } catch (e) {
    s.status = e instanceof StopRun ? 'stopped' : 'failed';
    s.error = e instanceof Error ? e.message : String(e);
    store.event(id, s.status, `${s.status === 'stopped' ? 'Stopped' : 'Failed'}: ${s.error}`);
    g.killChildren();
  } finally {
    store.unlock(s);
  }
  return s;
}
