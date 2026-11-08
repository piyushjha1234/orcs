import type { Architecture, Requirement } from '../src/types.ts';

export function requirement(): Requirement {
  return {
    goal: 'A small notes app where people keep private notes.',
    users: ['note takers'],
    non_goals: ['sharing notes'],
    brs: [
      { id: 'br-1', title: 'Sign in with email', text: 'Users sign in with email and password.', priority: 'must', ac: ['A user with a valid password reaches the notes page.'] },
      { id: 'br-2', title: 'Write notes', text: 'Users create and edit notes.', priority: 'should', ac: ['A saved note appears in the list.'] },
    ],
    targets: { platforms: ['web'], devices: ['desktop', 'phone'], browsers: ['chrome'], expected_users: 50, logins: true, personal_data: false, payments: false, public_api: false },
    constraints: [],
    assumptions: [],
  };
}

export function architecture(): Architecture {
  return {
    stack: [{ layer: 'app', choice: 'plain files', version: '1', why: 'smallest thing that works' }],
    setup: {
      runtime: 'sh',
      install: 'true',
      env: [{ name: 'NOTES_SECRET', example: 'change-me' }],
      commands: { build: 'true', test: 'true', start: 'sh start.sh', acceptance: 'sh tests/acceptance/run.sh' },
      url: 'http://localhost:3000',
      tests_dir: 'tests/acceptance/',
      ignore: ['dist/'],
    },
    interfaces: [{ id: 'if-1', kind: 'screen', name: 'notes page', spec: 'lists notes' }],
    developers: 2,
    tasks: [
      { id: 'dev-1', title: 'sign in', brs: ['br-1'], files: ['src/a.txt'], deps: [], steps: ['write a'], interfaces: ['if-1'], facts: [], ac: ['a exists'], test: 'test -f src/a.txt', skills: [] },
      { id: 'dev-2', title: 'notes list', brs: ['br-2'], files: ['src/b.txt'], deps: ['dev-1'], steps: ['write b'], interfaces: [], facts: [], ac: ['b says ok'], test: 'grep -q ok src/b.txt', skills: [] },
      { id: 'dev-3', title: 'note editor', brs: ['br-2'], files: ['src/c.txt'], deps: [], steps: ['write c'], interfaces: [], facts: [], ac: ['c exists'], test: 'test -f src/c.txt', skills: [] },
    ],
    test_scope: {
      types: ['functional', 'e2e', 'regression', 'ui', 'ux', 'accessibility', 'responsive', 'compatibility', 'load', 'stress', 'security'],
      matrix: [
        { id: 'env-1', browser: 'chrome', device: 'desktop', primary: true },
        { id: 'env-2', browser: 'chrome', device: 'iphone 15', primary: false },
      ],
      load_users: 50,
      tools: ['sh'],
    },
    flow: {
      steps: [{ id: 's-1', label: 'User signs in' }, { id: 's-2', label: 'Notes page' }],
      links: [{ from: 's-1', to: 's-2', label: 'valid password' }],
    },
    usage: ['Sign in with your email.', 'Write a note.'],
  };
}
