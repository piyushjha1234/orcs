import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.ORCS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'orcs-store-'));
const store = await import('../src/engine/store.ts');
const { ensureSeed } = await import('../src/engine/score.ts');

test('run ids continue from the score history', () => {
  ensureSeed();
  assert.equal(store.nextRunId(), 'orcs-2');
});

test('questions, answers and pending', () => {
  const id = 'orcs-9';
  const q = store.ask(id, { from: 'orcs', text: 'Test this project?', options: ['Yes', 'Skip testing'], recommended: 1 });
  assert.equal(q.id, 'q-1');
  assert.equal(store.pending(id).length, 1);
  assert.throws(() => store.answer(id, 'q-1', 'maybe', 'test'), /Pick a number/);
  assert.throws(() => store.answer(id, 'q-1', '3', 'test'), /Pick a number/);
  const a = store.answer(id, 'q-1', '2', 'test');
  assert.equal(store.answerText(q, a), 'Skip testing');
  assert.equal(store.pending(id).length, 0);
  assert.throws(() => store.answer(id, 'q-1', '1', 'test'), /already answered/);
  const free = store.ask(id, { from: 'analyst', text: 'Which login?', options: ['Email', 'Google'], recommended: 1, free_text: true });
  assert.equal(store.answerText(free, store.answer(id, free.id, 'Both, please', 'test')), 'Both, please');
});

test('frontmatter parsing', () => {
  const { data, body } = store.frontmatter('---\nmodel: claude-opus-5-5\ntools: Read, Bash\n---\nHello');
  assert.equal(data.model, 'claude-opus-5-5');
  assert.equal(data.tools, 'Read, Bash');
  assert.equal(body, 'Hello');
});

test('a live engine process blocks a second one', () => {
  const state = { id: 'orcs-8', pid: process.ppid } as unknown as Parameters<typeof store.lock>[0];
  assert.throws(() => store.lock(state), /already running/);
});
