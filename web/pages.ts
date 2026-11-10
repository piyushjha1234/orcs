// Route handlers. A run keeps one live connection while you move between its sections, so switching tabs never reloads the run.
import type { Architecture, BugReport, Requirement } from '../src/types.ts';
import type { ReportData } from '../src/engine/report.ts';
import type { RunView } from '../src/server/model.ts';
import { api, ApiError, type EventRow, type RunDetail } from './lib/api.ts';
import { announce, focusHeading, setTitle } from './lib/a11y.ts';
import { $, html, raw, type Raw } from './lib/dom.ts';
import { plural } from './lib/format.ts';
import { icon } from './lib/icons.ts';
import { navigate, onLeave, onNotFound, route } from './lib/router.ts';
import { openRun } from './lib/sse.ts';
import { askConfirm } from './components/confirm-dialog.ts';
import { askFolder, pendingFolder } from './lib/folder-dialog.ts';
import { statusLine } from './components/shared.ts';

type Section = 'progress' | 'questions' | 'bugs' | 'bug' | 'report' | 'plan';
type Kind = 'requirement' | 'architecture' | 'bugs' | 'report';

interface Cached {
  key: string;
  seq: number;
  value: unknown;
  error?: string;
}

interface Live {
  id: string;
  section: Section;
  bugId: string;
  view: RunView | null;
  events: EventRow[];
  cache: Partial<Record<Kind, Cached>>;
  loading: Set<Kind>;
  mounted: string;
  wantFocus: boolean;
  close: () => void;
}

const KEEP_EVENTS = 150;
const SECTIONS: Section[] = ['plan', 'progress', 'questions', 'bugs', 'report'];
const LABEL: Record<Section, string> = {
  progress: 'Progress',
  questions: 'Questions',
  bugs: 'Bugs',
  bug: 'Bugs',
  report: 'Report',
  plan: 'Plan',
};
const ICON: Record<Section, string> = {
  progress: 'progress',
  questions: 'question',
  bugs: 'bug',
  bug: 'bug',
  report: 'report',
  plan: 'plan',
};
const FETCH: Record<Kind, (id: string) => Promise<unknown>> = {
  requirement: api.requirement,
  architecture: api.architecture,
  bugs: api.bugs,
  report: api.report,
};
const RUN = '/runs/([\\w-]+)';

let live: Live | null = null;
let generation = 0;
let seq = 0;
let listTimer = 0;
let clockTimer = 0;

function msg(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

function setData<T>(el: Element | null, value: T): void {
  if (el) (el as Element & { data: T }).data = value;
}

function main(): HTMLElement {
  return document.getElementById('main') as HTMLElement;
}

function show(content: Raw): void {
  main().innerHTML = content.value;
  if (main().querySelector('h1, [data-focus]')) focusHeading(main());
  else main().focus();
}

function inRun(path: string, id: string): boolean {
  return path === `/runs/${id}` || path.startsWith(`/runs/${id}/`);
}

export function registerPages(): void {
  route(/^\/$/, () => showRuns());
  route(/^\/new\/?$/, () => showNew());
  route(new RegExp(`^${RUN}/?$`), (p) => showRun(p[0], 'progress', ''));
  route(new RegExp(`^${RUN}/questions/?$`), (p) => showRun(p[0], 'questions', ''));
  route(new RegExp(`^${RUN}/bugs/?$`), (p) => showRun(p[0], 'bugs', ''));
  route(new RegExp(`^${RUN}/bugs/([\\w-]+)/?$`), (p) => showRun(p[0], 'bug', p[1]));
  route(new RegExp(`^${RUN}/report/?$`), (p) => showRun(p[0], 'report', ''));
  route(new RegExp(`^${RUN}/plan/?$`), (p) => showRun(p[0], 'plan', ''));
  onNotFound(() => showMissing());
  onLeave(() => {
    window.clearInterval(listTimer);
    if (live && !inRun(location.pathname, live.id)) closeLive();
  });
  main().addEventListener('click', (e) => void onRunAction(e));
}

// ---- Runs list ----------------------------------------------------------

async function showRuns(): Promise<void> {
  const gen = ++generation;
  document.body.dataset.view = 'runs';
  setTitle('Runs');
  show(html`<div class="page-head"><h1>Runs</h1><button type="button" class="btn btn-primary" data-start-new>New run</button></div>
    <p class="error" id="list-error" hidden></p>
    <run-list></run-list>`);
  await refreshRuns();
  if (gen !== generation) return;
  window.clearInterval(listTimer);
  listTimer = window.setInterval(() => {
    if (!document.hidden) void refreshRuns();
  }, 4000);
}

async function refreshRuns(): Promise<void> {
  const err = $<HTMLElement>('#list-error');
  try {
    const { runs } = await api.runs();
    setData($('run-list'), runs);
    if (err) err.hidden = true;
  } catch (e) {
    if (err) {
      err.textContent = msg(e);
      err.hidden = false;
    }
  }
}

async function showNew(): Promise<void> {
  ++generation;
  if (!pendingFolder()) {
    const dir = await askFolder();
    if (!dir) {
      if (location.pathname !== '/') void navigate('/', true);
      return;
    }
  }
  document.body.dataset.view = 'new';
  setTitle('New run');
  show(html`<div class="page-head"><h1>New run</h1></div><new-run-form></new-run-form>`);
}

function showMissing(title = 'Page not found', body = 'Nothing lives at this address.'): void {
  document.body.dataset.view = 'other';
  setTitle(title);
  show(html`<h1>${title}</h1><p>${body}</p><p><a href="/">Back to runs</a></p>`);
}

// ---- Run pages ----------------------------------------------------------

async function showRun(id: string, section: Section, bugId: string): Promise<void> {
  const gen = ++generation;
  document.body.dataset.view = 'run';
  if (live && live.id === id) {
    live.section = section;
    live.bugId = bugId;
    renderNav();
    renderSection();
    titleFor(live);
    return;
  }
  closeLive();
  show(html`<p class="loading">Loading run…</p>`);
  let detail: RunDetail;
  try {
    detail = await api.run(id);
  } catch (err) {
    if (gen !== generation) return;
    if (err instanceof ApiError && err.status === 404) showMissing('Run not found', `No run called ${id}.`);
    else showMissing('Could not open this run', msg(err));
    return;
  }
  if (gen !== generation) return;

  const st: Live = {
    id, section, bugId, view: detail, events: [...detail.events.recent], cache: {},
    loading: new Set(), mounted: '', wantFocus: false, close: () => undefined,
  };
  live = st;
  show(html`<div class="run-page">
    <run-header></run-header>
    <p id="conn" class="conn" role="status" hidden></p>
    <div id="section" class="section"></div>
  </div>`);
  setData($('run-header'), detail);
  focusHeading(main());
  $('#section')?.addEventListener('answered', onAnswered);
  st.close = openRun(id, detail.events.total, {
    run: (view) => onRun(id, view),
    event: (row) => onEvent(id, row),
    status: (text) => onConn(id, text),
  });
  clockTimer = window.setInterval(() => {
    if (live?.view) setData($('run-header'), live.view);
  }, 15_000);
  titleFor(st);
  renderNav();
  renderSection();
}

function titleFor(st: Live): void {
  const name = st.view?.name ?? st.id;
  setTitle(st.section === 'progress' ? name : `${LABEL[st.section]}, ${name}`);
}

function closeLive(): void {
  live?.close();
  live = null;
  window.clearInterval(clockTimer);
  const nav = $<HTMLElement>('#sections');
  if (nav) {
    nav.hidden = true;
    nav.dataset.sig = '';
  }
}

function onRun(id: string, view: RunView): void {
  const st = live;
  if (!st || st.id !== id) return;
  const before = st.view;
  st.view = view;
  if (before) announceChanges(before, view);
  setData($('run-header'), view);
  renderNav();
  renderSection();
}

function announceChanges(before: RunView, after: RunView): void {
  const fresh = after.pending.length - before.pending.length;
  if (fresh > 0) announce(plural(fresh, 'new question needs you.', 'new questions need you.'));
  const ended = after.status === 'done' || after.status === 'failed' || after.status === 'stopped';
  if (ended && after.status !== before.status) announce(statusLine(after));
}

function onEvent(id: string, row: EventRow): void {
  const st = live;
  if (!st || st.id !== id || st.events.some((e) => e.seq === row.seq)) return;
  st.events.push(row);
  st.events.sort((a, b) => a.seq - b.seq);
  if (st.events.length > KEEP_EVENTS) st.events.splice(0, st.events.length - KEEP_EVENTS);
  renderSection();
}

function onConn(id: string, text: string): void {
  if (live?.id !== id) return;
  const el = $<HTMLElement>('#conn');
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
}

function onAnswered(e: Event): void {
  const st = live;
  const qid = (e as CustomEvent<{ id: string }>).detail.id;
  if (!st?.view) return;
  st.view = { ...st.view, pending: st.view.pending.filter((q) => q.id !== qid) };
  renderNav();
  renderSection();
}

async function onRunAction(e: Event): Promise<void> {
  const del = (e.target as Element).closest<HTMLButtonElement>('[data-delete]');
  if (del?.dataset.delete) {
    const id = del.dataset.delete;
    const ok = await askConfirm({
      title: `Delete ${id}?`,
      body: 'This stops the run and removes it from the list. The project folder on your computer stays.',
      confirm: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const err = $<HTMLElement>('#list-error');
    try {
      await api.deleteRun(id);
      if (location.pathname === `/runs/${id}` || location.pathname.startsWith(`/runs/${id}/`)) await navigate('/');
      else await refreshRuns();
    } catch (e) {
      if (err) {
        err.textContent = msg(e);
        err.hidden = false;
      }
    }
    return;
  }
  const btn = (e.target as Element).closest<HTMLButtonElement>('button[data-action]');
  const st = live;
  if (!btn || !st) return;
  const action = btn.dataset.action;
  if (action === 'stop') {
    const ok = await askConfirm({
      title: 'Stop this run?',
      body: 'The step it is on is interrupted. You can resume the run later from this page.',
      confirm: 'Stop run',
      danger: true,
    });
    if (!ok || live !== st) return;
  }
  setAlert('');
  btn.disabled = true;
  try {
    if (action === 'stop') {
      await api.stop(st.id);
      announce('Stopping the run.');
    } else {
      await api.resume(st.id);
      announce('Resuming the run.');
    }
  } catch (err) {
    setAlert(msg(err));
    btn.disabled = false;
  }
}

function setAlert(text: string): void {
  const el = $<HTMLElement>('[data-alert]');
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
}

function renderNav(): void {
  const nav = $<HTMLElement>('#sections');
  const st = live;
  if (!nav) return;
  if (!st?.view) {
    nav.hidden = true;
    return;
  }
  const v = st.view;
  const base = `/runs/${st.id}`;
  const bugs = st.cache.bugs?.value as BugReport | null | undefined;
  const openBugs = bugs ? bugs.bugs.filter((b) => b.status === 'open').length : 0;
  const pending = v.pending.length;
  const items = SECTIONS.map((s) => {
    const href = s === 'progress' ? base : `${base}/${s}`;
    const active = st.section === s || (s === 'bugs' && st.section === 'bug');
    const count = s === 'questions' && pending
      ? html` <span class="count">${pending}<span class="sr-only"> need you</span></span>`
      : s === 'bugs' && openBugs
        ? html` <span class="count">${openBugs}<span class="sr-only"> open</span></span>`
        : raw('');
    return html`<li><a href="${href}"${active ? raw(' aria-current="page"') : raw('')}>${icon(ICON[s], 20)}<span class="nav-label">${LABEL[s]}</span>${count}</a></li>`.value;
  }).join('');
  nav.hidden = false;
  if (nav.dataset.sig !== items) {
    nav.dataset.sig = items;
    nav.querySelector('ul')!.innerHTML = items;
  }
}

function stageKey(v: RunView): string {
  return [v.stage, v.round, v.status, v.ended_at ?? '', v.counters.rework].join('|');
}

async function ensure(st: Live, kind: Kind): Promise<void> {
  const v = st.view;
  if (!v) return;
  const key = stageKey(v);
  if (st.cache[kind]?.key === key || st.loading.has(kind)) return;
  st.loading.add(kind);
  try {
    st.cache[kind] = { key, seq: ++seq, value: await FETCH[kind](st.id) };
  } catch (err) {
    st.cache[kind] = { key, seq: ++seq, value: null, error: msg(err) };
  } finally {
    st.loading.delete(kind);
  }
  if (live === st) renderSection();
}

// Returns the cached value and starts a fetch when it is missing or out of date. Stale values stay on screen until replaced.
function need(st: Live, kind: Kind): Cached | undefined {
  void ensure(st, kind);
  return st.cache[kind];
}

function setHost(el: HTMLElement, sig: string, content: Raw): void {
  const host = el.querySelector<HTMLElement>('#sec-body');
  if (!host || host.dataset.sig === sig) return;
  host.dataset.sig = sig;
  host.innerHTML = content.value;
}

// Keeps one component inside #sec-body and only recreates it when its data signature changes.
function bodyHost(el: HTMLElement, sig: string, tag: string): Element | null {
  const host = el.querySelector<HTMLElement>('#sec-body');
  if (!host) return null;
  if (host.dataset.sig !== sig) {
    host.dataset.sig = sig;
    host.innerHTML = `<${tag}></${tag}>`;
  }
  return host.firstElementChild;
}

function errorBlock(text: string): Raw {
  return html`<p class="error" role="alert">Could not load this. ${text}</p>`;
}

function skeleton(section: Section): Raw {
  switch (section) {
    case 'progress':
      return html`<section aria-labelledby="h-tasks">
          <h2 id="h-tasks" data-focus>Tasks</h2>
          <task-board></task-board>
        </section>
        <section aria-labelledby="h-activity">
          <h2 id="h-activity">Activity</h2>
          <event-feed></event-feed>
        </section>`;
    case 'questions':
      return html`<section aria-labelledby="h-questions">
          <h2 id="h-questions" data-focus>Questions</h2>
          <div id="q-list"></div>
          <p class="empty" id="q-empty" hidden>No questions need you right now.</p>
        </section>
        <section aria-labelledby="h-answered" id="q-done-wrap" hidden>
          <h2 id="h-answered">Answered</h2>
          <div id="q-done"></div>
        </section>`;
    case 'bugs':
      return html`<section aria-labelledby="h-bugs">
          <h2 id="h-bugs" data-focus>Bugs</h2>
          <div id="sec-body"><p class="loading">Loading bugs…</p></div>
        </section>`;
    case 'bug':
      return html`<div id="sec-body"><p class="loading">Loading bug…</p></div>`;
    case 'report':
    case 'plan':
      return html`<div id="sec-body"><p class="loading">Loading…</p></div>`;
  }
}

function renderSection(): void {
  const st = live;
  const el = $<HTMLElement>('#section');
  if (!st?.view || !el) return;
  const key = `${st.section}|${st.bugId}`;
  if (st.mounted !== key) {
    if (st.mounted !== '') st.wantFocus = true;
    st.mounted = key;
    el.innerHTML = skeleton(st.section).value;
  }
  update(st, st.view, el);
  if (st.wantFocus && el.querySelector('[data-focus]')) {
    st.wantFocus = false;
    focusHeading(el);
  }
}

function update(st: Live, v: RunView, el: HTMLElement): void {
  switch (st.section) {
    case 'progress':
      setData(el.querySelector('task-board'), v.tasks);
      setData(el.querySelector('event-feed'), st.events);
      return;
    case 'questions':
      syncQuestions(st, v, el);
      return;
    case 'bugs': {
      const bugs = need(st, 'bugs');
      const arch = need(st, 'architecture');
      if (!bugs) return setHost(el, 'loading', html`<p class="loading">Loading bugs…</p>`);
      if (bugs.error) return setHost(el, `error-${bugs.seq}`, errorBlock(bugs.error));
      const report = bugs.value as BugReport | null;
      if (!report) return setHost(el, 'none', html`<p class="empty">Bugs appear once testing starts.</p>`);
      const host = bodyHost(el, `bugs-${bugs.seq}-${arch?.seq ?? 0}`, 'bug-list');
      setData(host, { runId: st.id, bugs: report.bugs, arch: arch?.value as Architecture | null | undefined });
      return;
    }
    case 'bug': {
      const bugs = need(st, 'bugs');
      const arch = need(st, 'architecture');
      if (!bugs) return setHost(el, 'loading', html`<p class="loading">Loading bug…</p>`);
      if (bugs.error) return setHost(el, `error-${bugs.seq}`, errorBlock(bugs.error));
      const report = bugs.value as BugReport | null;
      const bug = report?.bugs.find((b) => b.id === st.bugId);
      if (!bug) return setHost(el, `missing-${st.bugId}`, html`<p>No bug called ${st.bugId}.</p><p><a href="/runs/${st.id}/bugs">Back to bugs</a></p>`);
      const host = bodyHost(el, `bug-${bug.id}-${bugs.seq}-${arch?.seq ?? 0}`, 'bug-detail');
      setData(host, { runId: st.id, bug, arch: arch?.value as Architecture | null | undefined });
      return;
    }
    case 'report': {
      const c = need(st, 'report');
      if (!c) return setHost(el, 'loading', html`<p class="loading">Loading report…</p>`);
      if (c.error) return setHost(el, `error-${c.seq}`, errorBlock(c.error));
      setData(bodyHost(el, `report-${c.seq}`, 'report-view'), c.value as ReportData);
      return;
    }
    case 'plan': {
      const req = need(st, 'requirement');
      const arch = need(st, 'architecture');
      if (!req || !arch) return setHost(el, 'loading', html`<p class="loading">Loading plan…</p>`);
      if (req.error) return setHost(el, `error-${req.seq}`, errorBlock(req.error));
      if (arch.error) return setHost(el, `error-${arch.seq}`, errorBlock(arch.error));
      setData(bodyHost(el, `plan-${req.seq}-${arch.seq}`, 'plan-view'), {
        requirement: req.value as Requirement | null,
        architecture: arch.value as Architecture | null,
      });
      return;
    }
  }
}

// Adds cards for new questions and removes answered ones. Existing cards are left alone so typed text survives.
function syncQuestions(st: Live, v: RunView, el: HTMLElement): void {
  const list = el.querySelector<HTMLElement>('#q-list');
  const empty = el.querySelector<HTMLElement>('#q-empty');
  if (!list || !empty) return;
  const open = new Set(v.pending.map((q) => q.id));
  for (const card of [...list.children] as HTMLElement[]) {
    if (!open.has(card.dataset.qid ?? '')) card.remove();
  }
  for (const q of v.pending) {
    if (list.querySelector(`[data-qid="${q.id}"]`)) continue;
    const card = document.createElement('question-card') as HTMLElement;
    card.dataset.qid = q.id;
    list.append(card);
    setData(card, { runId: st.id, question: q });
  }
  empty.hidden = v.pending.length > 0;

  const done = el.querySelector<HTMLElement>('#q-done');
  const wrap = el.querySelector<HTMLElement>('#q-done-wrap');
  if (!done || !wrap) return;
  const sig = v.answered.map((a) => `${a.question.id}:${a.answer}`).join('|');
  if (done.dataset.sig !== sig) {
    done.dataset.sig = sig;
    done.innerHTML = html`<ul class="rows answered">${[...v.answered].reverse().map((a) => html`<li>
      <p class="answer-q">${a.question.text}</p>
      <p class="answer-a">${icon('check', 16)}<span>${a.answer}</span></p>
    </li>`)}</ul>`.value;
  }
  wrap.hidden = v.answered.length === 0;
}
