import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Convo, State } from '../src/types.ts';

test('a mistake is remembered for the developer and the architect', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orcs-lessons-'));
  const prev = process.env.ORCS_HOME;
  process.env.ORCS_HOME = dir;
  try {
    const { rememberMistake, lessonsFor } = await import('../src/engine/lessons.ts');
    const detail = 'The login test failed. The button stayed disabled.';
    rememberMistake('developer', 'task test', detail);
    rememberMistake('developer', 'task test', detail);
    assert.ok(lessonsFor('developer').some((l) => l.startsWith('task test:') && l.includes('login test failed')));
    assert.ok(lessonsFor('architect').some((l) => l.includes('button stayed disabled')));
    const all = JSON.parse(fs.readFileSync(path.join(dir, 'lessons.json'), 'utf8')) as { role: string; seen: number }[];
    assert.equal(all.find((l) => l.role === 'developer')?.seen, 2);
  } finally {
    if (prev === undefined) delete process.env.ORCS_HOME;
    else process.env.ORCS_HOME = prev;
  }
});

test('the same failure steps up the model before asking anyone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orcs-nudge-'));
  const prev = process.env.ORCS_HOME;
  process.env.ORCS_HOME = dir;
  try {
    const { nudge } = await import('../src/engine/agent.ts');
    const convo = { session: 's', started: true, model: 'claude-haiku-5-5', pending: [], next_prompt: '', done: false, repeats: 1 } as Convo;
    const state = { id: 'orcs-9' } as State;
    await nudge(state, 'dev-1', convo, 'The task test failed. The button stayed disabled.');
    assert.equal(convo.model, 'claude-sonnet-5-5');
    assert.equal(convo.repeats, 0);
    assert.ok(!fs.existsSync(path.join(dir, 'runs', 'orcs-9', 'inbox.jsonl')));
  } finally {
    if (prev === undefined) delete process.env.ORCS_HOME;
    else process.env.ORCS_HOME = prev;
  }
});
