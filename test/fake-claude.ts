#!/usr/bin/env node
// Stands in for `claude -p` in the end-to-end test: answers like each agent would, at zero tokens.
import fs from 'node:fs';
import path from 'node:path';
import { architecture, requirement } from './fixtures.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const role = flag('--append-system-prompt-file') ? path.basename(flag('--append-system-prompt-file')!, '.md') : 'security';
const model = flag('--model') ?? 'claude-sonnet-5-5';
const session = flag('--resume') ?? flag('--session-id') ?? 'none';
const raw = role === 'security' ? '{}' : fs.readFileSync(0, 'utf8');
const p = JSON.parse(raw || '{}') as Record<string, unknown>;
const cwd = process.cwd();

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  fs.writeFileSync(path.join(cwd, file), text);
}

function analyst(): unknown {
  if (p.request) return { status: 'ask', questions: [{ id: 'q-1', text: 'Do you need user accounts?', options: ['Yes', 'No'], recommended: 1 }] };
  return { status: 'done', ...requirement() };
}

function architect(): unknown {
  if (p.requirement) return { status: 'ask', questions: [{ id: 'q-1', text: 'Use plain files for the stack?', options: ['Plain files', 'Next.js'], recommended: 1 }] };
  return { status: 'done', ...architecture() };
}

function developer(): unknown {
  const id = path.basename(cwd);
  const run = path.basename(path.dirname(cwd));
  const input = JSON.parse(fs.readFileSync(path.join(process.env.ORCS_HOME!, 'runs', run, 'tasks', `${id}.json`), 'utf8'));
  if (id === 'dev-1' && p.task) return { status: 'ask', questions: [{ id: 'q-1', text: 'Email login only?', options: ['Yes', 'No'], recommended: 1 }] };
  const text = id === 'dev-2' && p.task ? 'first' : `ok ${Date.now()} ${Math.random()}`;
  for (const f of input.task.files as string[]) write(f, text);
  return { status: 'done' };
}

function tester(): unknown {
  const arch = p.architecture as ReturnType<typeof architecture>;
  const req = p.requirement as ReturnType<typeof requirement>;
  if (p.phase === 'plan') {
    write('tests/acceptance/run.sh', '#!/bin/sh\nexit 0\n');
    const cases = arch.test_scope.types.map((type, i) => ({
      id: `tc-${i + 1}`, br: req.brs[i % req.brs.length].id, type, envs: arch.test_scope.matrix.map((e) => e.id),
      title: `${type} check`, steps: ['open the app'], expected: 'it works', auto: true,
    }));
    return { status: 'done', cases, files: ['tests/acceptance/run.sh'] };
  }
  const verify = (p.verify_bugs as { id: string }[]) ?? [];
  const results = [{ case: 'tc-1', status: 'pass' }];
  if (verify.length) return { status: 'done', results, bugs: verify.map((b) => ({ ...b, status: 'fixed' })) };
  return {
    status: 'done', results,
    bugs: [{ id: 'bug-1', risk: 'medium', type: 'ui', br: 'br-1', env: 'env-1', file: 'src/a.txt', title: 'Sign in button is hidden', steps: ['open the app'], expected: 'button shows', actual: 'button hidden', evidence: 'screenshot', status: 'open' }],
  };
}

function security(): unknown {
  return {
    status: 'done', results: [],
    bugs: [{ id: 'bug-1', risk: 'low', type: 'security', br: 'none', env: 'none', file: 'src/c.txt', title: 'Missing security header', steps: ['check headers'], expected: 'header set', actual: 'missing', evidence: 'curl -I', status: 'open' }],
  };
}

const handlers: Record<string, () => unknown> = { analyst, architect, developer, tester, security };
const out = handlers[role]();
process.stdout.write(JSON.stringify({
  type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(out), structured_output: out,
  session_id: session, num_turns: 2, duration_ms: 5, total_cost_usd: 0.01,
  modelUsage: { [model]: { inputTokens: 10, outputTokens: 50, cacheReadInputTokens: 2000, cacheCreationInputTokens: 500, costUSD: 0.01, costBasis: 'list' } },
}));
