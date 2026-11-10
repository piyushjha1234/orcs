import test from 'node:test';
import assert from 'node:assert/strict';
import type { BugReport, State } from '../src/types.ts';
import { applyReadme, mermaid, renderReadme } from '../src/engine/readme.ts';
import { architectureSummary, brief, bugLines, minutes, progress, questionView, requirementSummary, tokens } from '../src/view.ts';
import { architecture, requirement } from './fixtures.ts';

const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function state(): State {
  return {
    id: 'orcs-2', name: 'notes app', project: '/tmp/notes', branch: 'main', base: 'abc', created_at: ago(24), updated_at: ago(0),
    stage: 'build', status: 'running', intake: { name: 'notes app', dir: '/tmp/notes', requirements: '', skills: [], global_skills: false },
    installed: [], skills: [], security_review: false, decisions: {}, fix: [], test: true, intensity: 'medium', round: 0,
    convos: {}, approvals: {}, counters: { rework: 0, scope_violations: 0, blockers: 0, contract_retries: 0 },
    tasks: {
      'dev-1': { id: 'dev-1', title: 'sign in', kind: 'build', status: 'merged', model: 'm', fails: 0 },
      'dev-2': { id: 'dev-2', title: 'notes list with a very long title that keeps going', kind: 'build', status: 'fixing', model: 'm', fails: 1, last_check: 'task test' },
      'dev-3': { id: 'dev-3', title: 'note editor', kind: 'build', status: 'waiting', model: 'm', fails: 0, note: 'needs dev-2' },
      tester: { id: 'tester', title: 'test plan and tests', kind: 'plan', status: 'building', model: 'm', fails: 0, started_at: ago(11) },
    },
  };
}

test('number formats are short', () => {
  assert.equal(tokens(950), '950');
  assert.equal(tokens(340_000), '340k');
  assert.equal(tokens(1_234_567), '1.2m');
  assert.equal(minutes(12), '12 min');
  assert.equal(minutes(190), '3h 10m');
});

test('progress shows every task with a title, in short lines', () => {
  const lines = progress(state(), [{ effective: 1_200_000, cost: 3.1 } as never], 0);
  const blob = lines.join(' ');
  assert.match(lines[0], /^orcs-2 · notes app · building · 24 min · 1\.2m tokens · \$3\.10$/);
  assert.match(blob, /done\s+dev-1\s+sign in/);
  assert.match(blob, /fixing\s+dev-2/);
  assert.ok(blob.includes('notes list with a very long title that keeps going'));
  assert.ok(blob.includes('task test failed once'));
  assert.match(blob, /waiting\s+dev-3/);
  assert.ok(blob.includes('needs dev-2'));
  assert.match(blob, /working\s+tester/);
  assert.equal(lines.at(-1), 'Nothing needs you right now.');
  for (const l of lines) assert.ok(l.length <= 80, `too long: ${l}`);
  assert.ok(!blob.includes('…'));
  assert.equal(progress(state(), [], 2).at(-1), '2 questions need you.');
});

test('statements keep whole sentences and stay within a few lines', () => {
  const text = 'The build failed on the login page. The button never enables. The console shows a missing token. A fourth sentence should stay hidden.';
  assert.equal(brief(text, 3), 'The build failed on the login page. The button never enables. The console shows a missing token.');
  assert.equal(brief('One very long sentence without a stop', 3), 'One very long sentence without a stop');
  const live = progress(state(), [], 0, 1);
  assert.match(live[0], /^[|/\\-] orcs-2 · notes app · building · \d+:\d{2}/);
  const shown = live.join(' ');
  assert.match(shown, /working\s+tester/);
  assert.match(shown, /\d+:\d{2}/);
});

test('questions show numbered options and the recommended one', () => {
  const lines = questionView({ id: 'q-3', from: 'analyst', text: 'Do you need accounts?', options: ['Yes', 'No'], recommended: 1, free_text: true, created_at: '' });
  assert.deepEqual(lines, ['analyst asks (q-3):', '  Do you need accounts?', '  [1] Yes (recommended)', '  [2] No', '  Type a number, or your own answer.']);
});

test('summaries and bug lists stay within 80 characters', () => {
  const report: BugReport = {
    round: 1,
    results: [],
    bugs: [
      { id: 'bug-1', risk: 'high', type: 'security', br: 'br-1', env: 'env-1', file: '', title: 'Wrong password still logs in', steps: [], expected: '', actual: '', evidence: '', status: 'open' },
      { id: 'bug-2', risk: 'low', type: 'ui', br: 'br-2', env: 'env-2', file: '', title: 'Save button hidden on small phones', steps: [], expected: '', actual: '', evidence: '', status: 'open' },
      { id: 'bug-3', risk: 'medium', type: 'api', br: 'br-2', env: 'none', file: '', title: 'Old bug', steps: [], expected: '', actual: '', evidence: '', status: 'fixed' },
    ],
  };
  const lines = bugLines(report, architecture());
  assert.equal(lines[0], 'Testing found 2 open bugs: 1 high, 0 medium, 1 low.');
  assert.equal(lines[1], '1 bug was fixed.');
  assert.ok(lines.some((l) => /bug-2.*ui · chrome on iphone 15/.test(l)));
  for (const l of [...lines, ...requirementSummary(requirement()), ...architectureSummary(architecture())]) assert.ok(l.length <= 80, `too long: ${l}`);
});

test('readme has the four sections and a valid flowchart', () => {
  const text = renderReadme('notes app', requirement(), architecture());
  for (const h of ['# notes app', '## Summary', '## How it works', '## Install', '## How to use']) assert.ok(text.includes(h), h);
  assert.match(mermaid(architecture().flow), /s_1 -->\|"valid password"\| s_2/);
  const noInstall = architecture();
  noInstall.setup = { ...noInstall.setup, runtime: '', install: '', env: [] };
  assert.ok(!renderReadme('x', requirement(), noInstall).includes('## Install'));
  const updated = applyReadme('# Mine\n\n<!-- orcs:start -->old<!-- orcs:end -->\n\nFooter', '<!-- orcs:start -->\nnew\n<!-- orcs:end -->\n');
  assert.equal(updated, '# Mine\n\n<!-- orcs:start -->\nnew\n<!-- orcs:end -->\n\nFooter');
});
