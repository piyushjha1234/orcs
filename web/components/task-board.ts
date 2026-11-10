// Every developer and tester task, with its state as a word and an icon. A task that changed since the last update flashes once.
import type { TaskState } from '../../src/types.ts';
import { Component } from '../lib/component.ts';
import { html, raw, type Raw } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import { since, WORD } from '../lib/format.ts';

function word(t: TaskState): string {
  return t.kind === 'plan' && t.status === 'building' ? 'working' : WORD[t.status];
}

function extra(t: TaskState): string {
  if (t.status === 'building' || t.status === 'checking') return t.started_at ? `for ${since(t.started_at)}` : '';
  if (t.status === 'fixing') return `${t.last_check ?? 'check'} failed ${t.fails > 1 ? `${t.fails} times` : 'once'}`;
  if (t.status === 'blocked') return 'waiting for your answer';
  if (t.status === 'waiting') return t.note ?? '';
  return '';
}

function item(t: TaskState, changed: boolean): Raw {
  const more = extra(t);
  return html`<li class="task task-${t.status}${changed ? ' changed' : ''}" data-task="${t.id}">
    <span class="task-state">${icon(t.status, 14)}<span>${word(t)}</span></span>
    <span class="task-main">
      <span class="task-title">${t.title}</span>
      <span class="task-meta"><span class="mono">${t.id}</span>${more ? html`<span class="task-extra">${more}</span>` : raw('')}</span>
    </span>
  </li>`;
}

export class TaskBoard extends Component<TaskState[]> {
  #previous = new Map<string, string>();
  #signature = '';

  protected render(tasks: TaskState[]): void {
    if (!tasks.length) {
      if (this.#signature !== 'empty') this.paint(html`<p class="empty">Tasks appear once the architect splits the work.</p>`);
      this.#signature = 'empty';
      this.#previous.clear();
      return;
    }
    // The page calls render on every activity line. Only repaint when a task or its minute counter changed.
    const signature = `${Math.floor(Date.now() / 60_000)}|${JSON.stringify(tasks)}`;
    if (signature === this.#signature) return;
    this.#signature = signature;
    const changed = new Set(tasks.filter((t) => this.#previous.has(t.id) && this.#previous.get(t.id) !== t.status).map((t) => t.id));
    this.paint(html`<ul class="tasks" aria-label="Tasks">${tasks.map((t) => item(t, changed.has(t.id)))}</ul>`);
    this.#previous = new Map(tasks.map((t) => [t.id, t.status]));
  }
}

customElements.define('task-board', TaskBoard);
