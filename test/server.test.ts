import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, type ChildProcess } from 'node:child_process';
import type { State } from '../src/types.ts';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orcs-server-'));
const project = path.join(home, 'notes-app');
fs.mkdirSync(project, { recursive: true });
process.env.ORCS_HOME = home;
process.env.ORCS_CLAUDE_BIN = path.resolve(import.meta.dirname, 'fake-claude.ts');
fs.chmodSync(process.env.ORCS_CLAUDE_BIN, 0o755);

const store = await import('../src/engine/store.ts');
const { serve } = await import('../src/server/http.ts');

type Reply = { status: number; headers: http.IncomingHttpHeaders; text: string };

let port = 0;
let token = '';
let stop: () => Promise<void> = async () => undefined;
let cookie = '';

before(async () => {
  const app = await serve({ host: '127.0.0.1', port: 0 });
  port = app.port;
  token = app.token;
  stop = app.close;
  cookie = token;
});

after(async () => {
  await stop();
});

function call(method: string, p: string, o: { cookie?: string | null; origin?: string | null; body?: unknown; type?: string; host?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const data = o.body === undefined ? undefined : JSON.stringify(o.body);
    const headers: Record<string, string> = { host: o.host ?? `127.0.0.1:${port}` };
    if (o.cookie !== null) headers.cookie = `orcs_session=${o.cookie ?? cookie}`;
    if (o.origin !== null) headers.origin = o.origin ?? `http://127.0.0.1:${port}`;
    if (data !== undefined) {
      headers['content-type'] = o.type ?? 'application/json';
      headers['content-length'] = String(Buffer.byteLength(data));
    }
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let text = '';
      res.on('data', (c: Buffer) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

const now = () => new Date().toISOString();

function seed(id: string, extra: Partial<State> = {}): State {
  const s: State = {
    id, name: 'notes app', project, branch: 'main', base: 'abc', created_at: now(), updated_at: now(),
    stage: 'analyst', status: 'stopped',
    intake: { name: 'notes app', dir: project, requirements: 'A private notes app.', skills: [], global_skills: false },
    installed: [], skills: [], security_review: false, decisions: {}, fix: [], test: null, intensity: null, round: 0,
    convos: {}, tasks: {}, approvals: {}, counters: { rework: 0, scope_violations: 0, blockers: 0, contract_retries: 0 },
    ...extra,
  };
  store.saveState(s);
  return s;
}

function waitFor<T>(check: () => T | undefined, ms = 15_000): Promise<T> {
  const until = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const v = check();
      if (v !== undefined) return resolve(v);
      if (Date.now() > until) return reject(new Error('timed out'));
      setTimeout(tick, 100);
    };
    tick();
  });
}

test('this computer can open the site, and a bad token is still refused', async () => {
  assert.equal((await call('GET', '/api/runs', { cookie: null })).status, 200);
  assert.equal((await call('GET', '/', { cookie: null })).status, 200);
  assert.equal((await call('GET', '/?token=wrong', { cookie: null })).status, 403);
  const link = await call('GET', `/runs/orcs-1?token=${token}`, { cookie: null });
  assert.equal(link.status, 302);
  assert.equal(link.headers.location, '/runs/orcs-1', 'the token is removed from the address');
  assert.match(String(link.headers['set-cookie']), /orcs_session=.*; HttpOnly; SameSite=Strict; Path=\//);
  assert.equal((await call('GET', '/api/runs')).status, 200);
});

test('a request under another host name is refused, which blocks DNS rebinding', async () => {
  const r = await call('GET', '/api/runs', { host: 'evil.example:' + port });
  assert.equal(r.status, 403);
});

test('writes must come from this origin and send JSON', async () => {
  const body = { name: 'x', requirements: 'y' };
  assert.equal((await call('POST', '/api/runs', { body, origin: null })).status, 403);
  assert.equal((await call('POST', '/api/runs', { body, origin: 'http://evil.example' })).status, 403);
  assert.equal((await call('POST', '/api/runs', { body, type: 'text/plain' })).status, 415);
});

test('new runs are checked before anything is created', async () => {
  const noName = await call('POST', '/api/runs', { body: { name: '', requirements: 'x' } });
  assert.equal(noName.status, 422);
  assert.deepEqual(JSON.parse(noName.text), { error: 'Give the project a name.', field: 'name' });
  const badSkill = await call('POST', '/api/runs', { body: { name: 'a', requirements: 'x', skills: 'foo$(id)' } });
  assert.equal(badSkill.status, 422);
  assert.match(JSON.parse(badSkill.text).error, /is not a skill source/);
});

test('answers use the same inbox as the CLI, with the same messages', async () => {
  seed('orcs-2');
  const q1 = store.ask('orcs-2', { from: 'orcs', text: 'Approve the requirement?', options: ['Approve', 'Change something'], recommended: 1, free_text: true });
  const q2 = store.ask('orcs-2', { from: 'orcs', text: 'Test this project?', options: ['Yes', 'Skip testing'], recommended: 1 });

  const bad = await call('POST', '/api/runs/orcs-2/answers', { body: { question: q2.id, answer: '9' } });
  assert.equal(bad.status, 422);
  assert.equal(JSON.parse(bad.text).error, 'Pick a number from 1 to 2.');

  const missing = await call('POST', '/api/runs/orcs-2/answers', { body: { question: 'q-99', answer: '1' } });
  assert.equal(missing.status, 404);

  const ok = await call('POST', '/api/runs/orcs-2/answers', { body: { question: q1.id, answer: '1' } });
  assert.equal(ok.status, 201);
  assert.equal(store.answers('orcs-2').get(q1.id)?.by, 'web');
});

test('a question answered in the CLI cannot be answered again from the web', async () => {
  seed('orcs-3');
  const q = store.ask('orcs-3', { from: 'orcs', text: 'Test this project?', options: ['Yes', 'Skip testing'], recommended: 1 });
  store.answer('orcs-3', q.id, '2', 'cli');
  const again = await call('POST', '/api/runs/orcs-3/answers', { body: { question: q.id, answer: '1' } });
  assert.equal(again.status, 409);
  assert.equal(JSON.parse(again.text).error, 'q-1 is already answered.');
  assert.equal(store.answers('orcs-3').get(q.id)?.by, 'cli', 'the first answer is kept');
});

test('the run page lists pending questions and recent events', async () => {
  seed('orcs-4');
  store.ask('orcs-4', { from: 'analyst', text: 'Which login?', options: ['Email', 'Google'], recommended: 1, free_text: true });
  store.event('orcs-4', 'stage', 'Analyst is working on the requirement.');
  const r = await call('GET', '/api/runs/orcs-4');
  const body = JSON.parse(r.text);
  assert.equal(body.pending.length, 1);
  assert.equal(body.pending[0].text, 'Which login?');
  assert.equal(body.events.total, 1);
  assert.equal(body.events.recent[0].text, 'Analyst is working on the requirement.');
  assert.equal(body.active, false);
});

test('the live stream sends a new event after the run folder changes', async () => {
  seed('orcs-5');
  const received = await new Promise<string>((resolve, reject) => {
    let buf = '';
    let triggered = false;
    const timer = setTimeout(() => reject(new Error('no event within 6s')), 6000);
    const req = http.get({ host: '127.0.0.1', port, path: '/api/runs/orcs-5/stream', headers: { cookie: `orcs_session=${cookie}` } }, (res) => {
      assert.match(String(res.headers['content-type']), /text\/event-stream/);
      res.on('data', (c: Buffer) => {
        buf += c.toString('utf8');
        // the first snapshot has arrived, so write a new event into the run folder
        if (!triggered && buf.includes('event: run')) {
          triggered = true;
          store.event('orcs-5', 'stage', 'Pick a fight');
        }
        if (buf.includes('"text":"Pick a fight"')) {
          clearTimeout(timer);
          req.destroy();
          resolve(buf);
        }
      });
    });
    req.on('error', () => undefined);
  });
  assert.match(received, /event: run/);
  assert.match(received, /"text":"Pick a fight"/);
});

test('stop sends SIGINT to the running engine, and refuses when nothing runs', async () => {
  seed('orcs-6');
  assert.equal((await call('POST', '/api/runs/orcs-6/stop', { body: {} })).status, 409);

  const child: ChildProcess = spawn('sleep', ['30']);
  seed('orcs-6', { status: 'running', pid: child.pid });
  const exited = new Promise<NodeJS.Signals | null>((resolve) => child.on('exit', (_c, sig) => resolve(sig)));
  const r = await call('POST', '/api/runs/orcs-6/stop', { body: {} });
  assert.equal(r.status, 202);
  assert.equal(await exited, 'SIGINT');
});

test('a finished run cannot be resumed', async () => {
  seed('orcs-7', { stage: 'done', status: 'done' });
  const r = await call('POST', '/api/runs/orcs-7/resume', { body: {} });
  assert.equal(r.status, 409);
  assert.equal(JSON.parse(r.text).error, 'orcs-7 is finished.');
});

test('resume starts an engine process, and stop ends it cleanly', async () => {
  seed('orcs-8');
  const started = await call('POST', '/api/runs/orcs-8/resume', { body: {} });
  assert.equal(started.status, 202);

  const pid = await waitFor(() => {
    const s = store.loadState('orcs-8');
    return s.status === 'running' && s.pid ? s.pid : undefined;
  });
  assert.notEqual(pid, process.pid);

  const again = await call('POST', '/api/runs/orcs-8/resume', { body: {} });
  assert.equal(again.status, 409, 'a second resume while running is refused');

  const stopped = await call('POST', '/api/runs/orcs-8/stop', { body: {} });
  assert.equal(stopped.status, 202);
  const s = await waitFor(() => {
    const cur = store.loadState('orcs-8');
    return cur.status === 'stopped' ? cur : undefined;
  });
  assert.equal(s.error, 'You pressed Ctrl-C.');
  assert.equal(s.pid, undefined);
});

test('browser code is served as JavaScript, gzipped when the browser asks', async () => {
  const plain = await call('GET', '/web/lib/format.ts');
  assert.equal(plain.status, 200);
  assert.match(String(plain.headers['content-type']), /text\/javascript/);
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.ok(!plain.text.includes('import type'), 'types are stripped');

  const zipped = await new Promise<{ headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: '/web/lib/format.ts',
      headers: { host: `127.0.0.1:${port}`, cookie: `orcs_session=${cookie}`, 'accept-encoding': 'gzip, br' },
    }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(parts) }));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(zipped.headers['content-encoding'], 'gzip');
  assert.equal(zipped.headers.vary, 'Accept-Encoding');
  assert.equal(zlib.gunzipSync(zipped.body).toString('utf8'), plain.text);
});

test('a project folder can be opened, and a file cannot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orcs-dirs-'));
  fs.mkdirSync(path.join(root, 'child'));
  fs.writeFileSync(path.join(root, 'note.txt'), 'x');
  const listed = await call('GET', '/api/dirs?path=' + encodeURIComponent(root));
  assert.equal(listed.status, 200);
  const body = JSON.parse(listed.text) as { path: string; parent: string; dirs: string[] };
  assert.equal(body.path, root);
  assert.equal(body.parent, path.dirname(root));
  assert.deepEqual(body.dirs, ['child']);
  assert.equal((await call('GET', '/api/dirs?path=' + encodeURIComponent(path.join(root, 'missing')))).status, 422);
  assert.equal((await call('GET', '/api/dirs?path=' + encodeURIComponent(path.join(root, 'note.txt')))).status, 422);
  const preview = await call('GET', '/api/folder?name=Notes%20App&dir=' + encodeURIComponent(root));
  assert.equal(JSON.parse(preview.text).dir, path.join(root, 'notes-app'));
  const prev = process.env.ORCS_FOLDER_PICK;
  process.env.ORCS_FOLDER_PICK = root;
  const picked = await call('POST', '/api/pick-folder', { body: { path: root } });
  assert.equal(picked.status, 200);
  assert.equal(JSON.parse(picked.text).path, root);
  process.env.ORCS_FOLDER_PICK = 'cancel';
  assert.equal(JSON.parse((await call('POST', '/api/pick-folder', { body: {} })).text).path, null);
  process.env.ORCS_FOLDER_PICK = path.join(root, 'note.txt');
  assert.equal((await call('POST', '/api/pick-folder', { body: {} })).status, 422);
  if (prev === undefined) delete process.env.ORCS_FOLDER_PICK;
  else process.env.ORCS_FOLDER_PICK = prev;
});

test('a running project can be deleted, and a finished one cannot', async () => {
  seed('orcs-80', { status: 'running', pid: 999_999 });
  assert.equal(fs.existsSync(store.runFile('orcs-80', 'state.json')), true);
  const gone = await call('DELETE', '/api/runs/orcs-80', { body: {} });
  assert.equal(gone.status, 204);
  assert.equal(fs.existsSync(store.runDir('orcs-80')), false);
  seed('orcs-81', { status: 'done' });
  assert.equal((await call('DELETE', '/api/runs/orcs-81', { body: {} })).status, 409);
  assert.equal(fs.existsSync(store.runFile('orcs-81', 'state.json')), true);
});

test('each agent model can be picked, reset, and is used for new sessions', async () => {
  const { loadAgent, defaultModel } = await import('../src/engine/agent.ts');
  const first = JSON.parse((await call('GET', '/api/settings')).text) as { models: string[]; agents: { role: string; model: string; default: string }[] };
  assert.deepEqual(first.agents.map((a) => a.role), ['analyst', 'architect', 'developer', 'tester']);
  assert.ok(first.agents.every((a) => a.model === '' && first.models.includes(a.default)));

  const saved = await call('PUT', '/api/settings', { body: { agents: { developer: 'claude-opus-5-5' } } });
  assert.equal(saved.status, 200);
  assert.equal(JSON.parse(saved.text).agents.find((a: { role: string }) => a.role === 'developer').model, 'claude-opus-5-5');
  assert.equal(loadAgent('developer').model, 'claude-opus-5-5');
  assert.equal(loadAgent('analyst').model, defaultModel('analyst'));

  const bad = await call('PUT', '/api/settings', { body: { agents: { tester: 'gpt-4' } } });
  assert.equal(bad.status, 422);
  assert.equal(JSON.parse(bad.text).field, 'tester');
  assert.equal(loadAgent('tester').model, defaultModel('tester'));

  await call('PUT', '/api/settings', { body: { agents: { developer: '' } } });
  assert.equal(loadAgent('developer').model, defaultModel('developer'));
  assert.equal((await call('PUT', '/api/settings', { body: {}, origin: 'http://evil.test' })).status, 403);
});

test('files outside the web folder are never served', async () => {
  const r = await call('GET', '/src/cli.ts');
  assert.equal(r.status, 404);
  assert.ok(!r.text.includes('#!/usr/bin/env node'));
});
