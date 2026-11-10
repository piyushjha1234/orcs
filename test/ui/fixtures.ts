// Starts orcs ui on a random local port over a throwaway ~/.orcs with three runs:
// orcs-1 waits on two questions, orcs-2 is finished with bugs and a report, orcs-3 was stopped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Architecture, Bug, BugReport, State, Usage } from '../../src/types.ts';
import { architecture, requirement } from '../fixtures.ts';

export interface App {
  url: string;
  token: string;
  home: string;
  store: typeof import('../../src/engine/store.ts');
  close: () => Promise<void>;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

function state(id: string, project: string, extra: Partial<State>): State {
  const now = new Date().toISOString();
  return {
    id, name: 'notes app', project, branch: 'main', base: 'abc', created_at: now, updated_at: now,
    stage: 'analyst', status: 'stopped',
    intake: { name: 'notes app', dir: project, requirements: 'A private notes app.', skills: [], global_skills: false },
    installed: [], skills: [], security_review: false, decisions: {}, fix: [], test: null, intensity: null, round: 0,
    convos: {}, tasks: {}, approvals: {},
    counters: { rework: 0, scope_violations: 0, blockers: 0, contract_retries: 0 },
    ...extra,
  };
}

const BUGS: BugReport = {
  round: 1,
  results: [{ case: 'tc-1', status: 'pass' }, { case: 'tc-2', status: 'fail' }],
  bugs: [
    {
      id: 'bug-1', risk: 'high', type: 'functional', br: 'br-1', env: 'env-1', file: 'src/a.txt',
      title: 'Sign-in fails with a valid password',
      steps: ['Open the sign-in page.', 'Enter a valid email and password.', 'Press Sign in.'],
      expected: 'The notes page opens.', actual: 'The page shows “Invalid password”.',
      evidence: 'POST /sign-in 401\nbody: {"error":"invalid"}', status: 'open',
    },
    {
      id: 'bug-2', risk: 'medium', type: 'ui', br: 'br-2', env: 'env-2', file: 'src/b.txt',
      title: 'Note list does not refresh after save',
      steps: ['Create a note.', 'Go back to the list.'],
      expected: 'The new note is listed.', actual: 'The list is empty until reload.',
      evidence: 'screenshot: list-after-save.png', status: 'open',
    },
    {
      id: 'bug-3', risk: 'low', type: 'ux', br: 'none', env: 'none', file: '',
      title: 'Save button label is unclear',
      steps: ['Open a note.'], expected: 'The button says Save.', actual: 'The button says Go.',
      evidence: '', status: 'fixed',
    },
  ] satisfies Bug[],
};

const USAGE: Usage[] = [
  { at: new Date().toISOString(), run: 'orcs-1', agent: 'analyst', model: 'sonnet', session: 's1', turns: 4, input: 1200, output: 900, cache_write: 300, cache_read: 2000, effective: 2600, cost: 0.42, cost_basis: 'api', duration_ms: 90000, outcome: 'ok' },
];

export async function startApp(): Promise<App> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orcs-ui-'));
  process.env.ORCS_HOME = home;
  process.env.ORCS_CLAUDE_BIN = path.resolve(HERE, '..', 'fake-claude.ts');
  fs.chmodSync(process.env.ORCS_CLAUDE_BIN, 0o755);
  const store = await import('../../src/engine/store.ts');
  const { serve } = await import('../../src/server/http.ts');

  const project = path.join(home, 'notes-app');
  fs.mkdirSync(project, { recursive: true });

  store.saveState(state('orcs-1', project, { stage: 'analyst', status: 'waiting', round: 0 }));
  store.ask('orcs-1', { from: 'orcs', text: 'Approve the requirement?', options: ['Approve', 'Change something'], recommended: 1, free_text: true });
  store.ask('orcs-1', { from: 'analyst', text: 'Which sign-in method should we use?', options: ['Email and password', 'Google account'], recommended: 1, details: ['Email is simpler to test.'] });
  store.event('orcs-1', 'stage', 'Analyst is working on the requirement.');
  store.event('orcs-1', 'question', 'Asked: Approve the requirement?');

  store.saveState(state('orcs-2', project, {
    stage: 'done', status: 'done', round: 1, test: true, intensity: 'medium', rating: 4, ended_at: new Date().toISOString(),
    tasks: {
      'dev-1': { id: 'dev-1', title: 'sign in', kind: 'build', status: 'merged', model: 'sonnet', fails: 0 },
      'dev-2': { id: 'dev-2', title: 'notes list', kind: 'build', status: 'merged', model: 'sonnet', fails: 1 },
    },
  }));
  store.writeJson(store.runFile('orcs-2', 'requirement.json'), requirement());
  store.writeJson(store.runFile('orcs-2', 'architecture.json'), architecture() satisfies Architecture);
  store.writeJson(store.runFile('orcs-2', 'bugs.json'), BUGS);
  for (const u of USAGE) store.appendLine(store.runFile('orcs-2', 'usage.jsonl'), { ...u, run: 'orcs-2' });
  store.event('orcs-2', 'stage', 'Report is ready.');

  store.saveState(state('orcs-3', project, { stage: 'build', status: 'stopped', error: 'You pressed Ctrl-C.' }));
  store.event('orcs-3', 'stage', 'Build stopped.');

  // orcs-4 looks active: a real child process holds its pid, so the stop button is shown. Nothing is run.
  const worker: ChildProcess = spawn('sleep', ['600'], { stdio: 'ignore' });
  store.saveState(state('orcs-4', project, {
    stage: 'build', status: 'running', pid: worker.pid,
    tasks: { 'dev-1': { id: 'dev-1', title: 'sign in', kind: 'build', status: 'building', model: 'sonnet', fails: 0, started_at: new Date().toISOString() } },
  }));
  store.event('orcs-4', 'stage', 'Developers are building the sign-in page.');

  const app = await serve({ host: '127.0.0.1', port: 0 });
  return {
    url: `http://127.0.0.1:${app.port}`,
    token: app.token,
    home,
    store,
    close: async () => {
      worker.kill();
      await app.close();
    },
  };
}
