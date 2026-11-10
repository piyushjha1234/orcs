import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { BugReport, State, Usage } from '../src/types.ts';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orcs-e2e-'));
process.env.ORCS_HOME = home;
process.env.ORCS_CLAUDE_BIN = path.resolve(import.meta.dirname, 'fake-claude.ts');
fs.chmodSync(process.env.ORCS_CLAUDE_BIN, 0o755);

const store = await import('../src/engine/store.ts');
const { createRun, runEngine } = await import('../src/engine/run.ts');

function autoAnswer(id: string): () => void {
  let nextWhat = '1';
  const said: string[] = [];
  const timer = setInterval(() => {
    for (const q of store.pending(id)) {
      let a = String(q.recommended || 1);
      if (q.text === 'Approve the architecture?' && !said.includes('change')) {
        said.push('change');
        a = '2';
      }
      if (q.text.startsWith('What should change')) a = 'Keep it simple.';
      if (q.options.includes('Only the security review')) a = String(q.options.indexOf('Only the security review') + 1);
      if (q.text === 'How hard should AI test it?') a = '2';
      if (q.text === 'What next?') {
        a = nextWhat;
        nextWhat = '4';
      }
      if (q.text.startsWith('Rate this delivery')) a = '9';
      store.answer(id, q.id, a, 'test');
    }
  }, 50);
  return () => clearInterval(timer);
}

test('a full run with a fake claude: questions, change, blocker, rework, testing, fix round, readme, score', { timeout: 120_000 }, async () => {
  const project = path.join(home, 'notes-app');
  const s = createRun({ name: 'notes app', dir: project, requirements: 'A private notes app.', skills: [], global_skills: false });
  assert.equal(s.id, 'orcs-2');
  const stop = autoAnswer(s.id);
  const end: State = await runEngine(s.id);
  stop();
  assert.equal(end.error, undefined);
  assert.equal(end.status, 'done');
  assert.equal(end.stage, 'done');

  assert.equal(end.tasks['dev-2'].fails, 1, 'dev-2 failed its task test once, then passed');
  assert.equal(end.counters.blockers, 1, 'dev-1 asked one blocker question');
  assert.equal(end.intensity, 'medium');
  assert.equal(end.security_review, true);
  assert.equal(end.tasks['fix-1'].status, 'merged');

  const report = store.readJson<BugReport>(store.runFile(s.id, 'bugs.json'));
  assert.equal(report.round, 2);
  assert.equal(report.bugs.find((b) => b.id === 'bug-1')?.status, 'fixed');
  assert.equal(report.bugs.find((b) => b.type === 'security')?.status, 'open');
  for (const b of report.bugs) assert.match(b.id, /^bug-\d+$/);

  const csv = fs.readFileSync(store.runFile(s.id, 'bug-report.csv'), 'utf8');
  assert.match(csv, /^id,risk,type,requirement,environment,title,steps,expected,actual,evidence,status\n/);
  assert.match(csv, /chrome on desktop/);

  const agents = new Set(store.readLines<Usage>(store.runFile(s.id, 'usage.jsonl')).map((u) => u.agent));
  assert.deepEqual([...agents].sort(), ['analyst', 'architect', 'developer', 'security', 'tester']);

  const md = fs.readFileSync(store.runFile(s.id, 'report.md'), 'utf8');
  assert.match(md, /## Tokens by agent/);
  assert.match(md, /task test: 1 rerun \(dev-2\)/);
  const scores = store.readLines<{ id: string; tested: boolean; intensity: string; score: number }>(path.join(home, 'scores.jsonl'));
  const mine = scores.find((r) => r.id === 'orcs-2');
  assert.ok(mine && mine.tested && mine.intensity === 'medium' && mine.score > 0);

  const readme = fs.readFileSync(path.join(project, 'readme.md'), 'utf8');
  assert.match(readme, /## How it works\n\n```mermaid\nflowchart TD/);
  for (const f of ['src/a.txt', 'src/b.txt', 'src/c.txt', 'tests/acceptance/run.sh']) assert.ok(fs.existsSync(path.join(project, f)), f);
  assert.match(fs.readFileSync(path.join(project, 'src/b.txt'), 'utf8'), /^ok/);
  const branches = execFileSync('git', ['branch', '--list', 'orcs/*'], { cwd: project, encoding: 'utf8' });
  assert.match(branches, /orcs\/orcs-2\/main/);
  assert.equal(fs.existsSync(store.worktreeDir(s.id)) ? fs.readdirSync(store.worktreeDir(s.id)).length : 0, 0, 'worktrees are cleaned up');
});
