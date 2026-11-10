// The activity timeline, newest first. New lines are added to the top; the list is not announced line by line.
// Each line carries its kind as a word, so the coloured marker is never the only signal.
import type { EventRow } from '../lib/api.ts';
import { Component } from '../lib/component.ts';
import { html, type Raw } from '../lib/dom.ts';
import { clock } from '../lib/format.ts';

const KIND: Record<string, [label: string, tone: string]> = {
  start: ['Start', 'ok'],
  stage: ['Stage', 'ok'],
  approved: ['Approved', 'ok'],
  merged: ['Merged', 'ok'],
  done: ['Done', 'ok'],
  finish: ['Finish', 'ok'],
  question: ['Question', 'warn'],
  pause: ['Paused', 'warn'],
  rework: ['Rework', 'danger'],
  bugs: ['Bugs', 'danger'],
  test: ['Test', 'info'],
  task: ['Task', 'info'],
  model: ['Model', 'violet'],
  skill: ['Skills', 'violet'],
  change: ['Change', 'violet'],
};

function line(e: EventRow): Raw {
  const [label, tone] = KIND[e.kind] ?? [e.kind, 'muted'];
  return html`<li class="event tone-${tone}" data-seq="${e.seq}">
    <time datetime="${e.at}">${clock(e.at)}</time>
    <span class="event-mark" aria-hidden="true"></span>
    <span class="event-body"><span class="event-text">${e.text}</span><span class="event-meta">${label}${e.task ? html` · <span class="mono">${e.task}</span>` : ''}</span></span>
  </li>`;
}

class EventFeed extends Component<EventRow[]> {
  #last = -1;

  protected render(rows: EventRow[]): void {
    const list = this.querySelector('ol');
    if (!rows.length) {
      this.paint(html`<p class="empty">Nothing has happened yet.</p>`);
      this.#last = -1;
      return;
    }
    if (!list) {
      this.paint(html`<div role="log" aria-live="off" aria-label="Activity, newest first"><ol class="feed">${[...rows].reverse().map(line)}</ol></div>`);
      this.#last = rows[rows.length - 1].seq;
      return;
    }
    const fresh = rows.filter((r) => r.seq > this.#last).reverse();
    if (!fresh.length) return;
    list.insertAdjacentHTML('afterbegin', fresh.map((r) => line(r).value).join(''));
    while (list.childElementCount > rows.length) list.lastElementChild?.remove();
    this.#last = rows[rows.length - 1].seq;
  }
}

customElements.define('event-feed', EventFeed);
