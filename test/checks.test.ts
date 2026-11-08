import test from 'node:test';
import assert from 'node:assert/strict';
import { checkArchitecture, checkRequirement, checkTestPlan, cycles, minTypes, needs, outOfScope, overlaps, readyTasks } from '../src/engine/checks.ts';
import { architecture, requirement } from './fixtures.ts';

const done = (_key: string, value: object) => ({ status: 'done', ...value });

test('a valid requirement and architecture pass', () => {
  assert.deepEqual(checkRequirement(done('requirement', requirement())), []);
  assert.deepEqual(checkArchitecture(done('architecture', architecture()), requirement(), []), []);
});

test('missing fields on a done output are reported', () => {
  const { tasks: _tasks, ...partial } = architecture();
  assert.deepEqual(checkArchitecture({ status: 'done', ...partial }, requirement(), []), ['status is done but tasks is missing']);
});

test('requirement: duplicate ids and missing criteria are caught', () => {
  const r = requirement();
  r.brs[1].id = 'br-1';
  r.brs[1].ac = [' '];
  const errors = checkRequirement(done('requirement', r));
  assert.ok(errors.includes('br-1 is used twice'));
  assert.ok(errors.some((e) => e.includes('no acceptance criteria')));
});

test('architecture: uncovered requirement, unordered shared file, cycle, tests_dir, skills', () => {
  const a = architecture();
  a.tasks[0].brs = [];
  a.tasks[2].files = ['src/b.txt'];
  a.tasks[0].deps = ['dev-2'];
  a.tasks[1].files.push('tests/acceptance/x.sh');
  a.tasks[1].skills = ['impeccable'];
  const errors = checkArchitecture(done('architecture', a), requirement(), []).join('\n');
  assert.match(errors, /br-1 \(must\) is not covered/);
  assert.match(errors, /dev-2 and dev-3 share src\/b\.txt/);
  assert.match(errors, /dependency cycle/);
  assert.match(errors, /inside tests_dir/);
  assert.match(errors, /skill impeccable/);
});

test('architecture: test scope must include the minimum types', () => {
  const a = architecture();
  a.test_scope.types = ['functional'];
  const errors = checkArchitecture(done('architecture', a), requirement(), []).join('\n');
  for (const t of ['ui', 'ux', 'load', 'stress', 'security', 'e2e']) assert.match(errors, new RegExp(`needs ${t}`));
});

test('minimum test types follow the targets', () => {
  const t = requirement().targets;
  assert.deepEqual(minTypes({ ...t, platforms: ['api'], expected_users: 0, logins: false }), ['functional', 'e2e', 'regression', 'api']);
  assert.ok(minTypes(t).includes('responsive'));
});

test('intensity decides what the test plan must cover', () => {
  const r = requirement(), a = architecture();
  assert.deepEqual(needs('low', r, a).brs, ['br-1']);
  assert.ok(!needs('low', r, a).types.includes('stress'));
  assert.deepEqual(needs('medium', r, a).envs, ['env-1']);
  assert.deepEqual(needs('high', r, a).envs, ['env-1', 'env-2']);
  const plan = { status: 'done', files: ['tests/acceptance/run.sh'], cases: [{ id: 'tc-1', br: 'br-1', type: 'functional', envs: ['env-1'], title: 't', steps: [], expected: 'x', auto: true }] };
  const errors = checkTestPlan(plan, r, a, 'high').join('\n');
  assert.match(errors, /no case covers br-2/);
  assert.match(errors, /no case covers test type stress/);
  assert.match(errors, /no case runs on env-2/);
  assert.match(checkTestPlan({ ...plan, files: ['src/x.ts'] }, r, a, 'low').join('\n'), /outside tests_dir/);
});

test('file scope and overlaps', () => {
  assert.deepEqual(outOfScope(['src/a.ts', 'src/ui/b.ts', 'package.json'], ['src/a.ts', 'src/ui/']), ['package.json']);
  assert.ok(overlaps('src/ui/', 'src/ui/b.ts'));
  assert.ok(!overlaps('src/a.ts', 'src/ab.ts'));
});

test('scheduler starts only tasks whose dependencies are merged', () => {
  const tasks = architecture().tasks;
  assert.deepEqual(readyTasks(tasks, new Set(), new Set()).map((t) => t.id), ['dev-1', 'dev-3']);
  assert.deepEqual(readyTasks(tasks, new Set(['dev-1']), new Set(['dev-3'])).map((t) => t.id), ['dev-2']);
  const loop = tasks.map((t) => ({ ...t, deps: t.id === 'dev-1' ? ['dev-2'] : t.deps }));
  assert.deepEqual(cycles(loop).sort(), ['dev-1', 'dev-2']);
});
