import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isSource, linkSkills, parseSkillAnswer, parseSkillList, projectSkills, recommendations } from '../src/engine/skills.ts';
import { launchMode, modeFlags, schema, stronger } from '../src/engine/agent.ts';
import { addWorktree, changedFiles, commitAll, ensureRepo, excludeLocal } from '../src/engine/git.ts';
import { requirement } from './fixtures.ts';

test('recommendations follow the requirement targets', () => {
  assert.deepEqual(recommendations(requirement()).map((r) => r.name), ['impeccable', 'security-review']);
  const api = requirement();
  api.targets = { ...api.targets, platforms: ['api'], logins: false };
  assert.deepEqual(recommendations(api).map((r) => r.name), []);
  api.targets.public_api = true;
  assert.deepEqual(recommendations(api).map((r) => r.name), ['security-review']);
});

test('skill input parsing', () => {
  assert.deepEqual(parseSkillList(' vercel-labs/agent-skills@react, react  '), ['vercel-labs/agent-skills@react', 'react']);
  assert.ok(isSource('pbakaus/impeccable'));
  assert.ok(isSource('https://github.com/pbakaus/impeccable'));
  assert.ok(!isSource('react'));
  assert.deepEqual(parseSkillAnswer('react, owner/repo@skill global'), { items: ['react', 'owner/repo@skill'], global: true });
  assert.deepEqual(parseSkillAnswer(''), { items: [], global: false });
});

test('project skills are listed and linked into worktrees', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'orcs-skills-'));
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'orcs-wt-'));
  fs.mkdirSync(path.join(project, '.claude', 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(project, '.claude', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: A demo skill.\n---\nHi');
  assert.deepEqual(projectSkills(project), [{ name: 'demo', description: 'A demo skill.' }]);
  linkSkills(project, wt);
  assert.ok(fs.existsSync(path.join(wt, '.claude', 'skills', 'demo', 'SKILL.md')));
});

test('the linked skills folder is never committed from a worktree', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'orcs-link-'));
  fs.mkdirSync(path.join(project, '.claude', 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(project, '.claude', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\n---\n');
  const { base } = ensureRepo(project);
  excludeLocal(project, ['.claude/skills']);
  const wt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'orcs-link-wt-')), 'dev-1');
  addWorktree(project, wt, 'orcs/t/dev-1', base);
  linkSkills(project, wt);
  fs.writeFileSync(path.join(wt, 'a.txt'), 'a');
  commitAll(wt, 'work');
  assert.deepEqual(changedFiles(wt, base), ['a.txt']);
});

test('launch mode follows the global-skills answer and project skills', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'orcs-empty-'));
  const state = (global: boolean, project: string) => ({ intake: { global_skills: global }, project }) as never;
  assert.equal(launchMode(state(false, empty)), 'safe');
  assert.equal(launchMode(state(true, empty)), 'global');
  assert.deepEqual(modeFlags('safe'), ['--safe-mode']);
  const project = JSON.parse(modeFlags('project')[3]);
  assert.equal(project.autoMemoryEnabled, false);
  assert.equal(project.disableAllHooks, true);
  assert.match(modeFlags('global')[3], /claudeMdExcludes/);
});

test('schemas inline the shared question format', () => {
  const s = JSON.parse(schema('requirement'));
  assert.equal(s.properties.questions.items.properties.text.maxLength, 100);
  assert.equal(stronger('claude-haiku-5-5'), 'claude-sonnet-5-5');
  assert.equal(stronger('claude-opus-5-5'), undefined);
});
