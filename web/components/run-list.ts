// The runs list. A table from 768px up and a stacked list below it. Only one is visible, so screen readers hear one.
import type { RunSummary } from '../../src/server/model.ts';
import { Component } from '../lib/component.ts';
import { html, raw, type Raw } from '../lib/dom.ts';
import { ago } from '../lib/format.ts';
import { icon } from '../lib/icons.ts';
import { pendingBadge, statusBadge } from './shared.ts';

function score(s: RunSummary): Raw {
  return s.score === null ? html`<span class="muted" aria-hidden="true">–</span><span class="sr-only">Not scored</span>` : html`${s.score}`;
}

function remove(r: RunSummary): Raw {
  if (r.status !== 'running') return raw('');
  return html`<button type="button" class="icon-btn bin-btn" data-delete="${r.id}" aria-label="Delete ${r.id}">${icon('bin', 18)}</button>`;
}

function card(r: RunSummary): Raw {
  return html`<li class="run-card">
    <div class="run-card-top">
      <a class="run-name" href="/runs/${r.id}">${r.name}</a>
      ${remove(r)}
    </div>
    <p class="run-card-meta">${statusBadge(r.status)}${pendingBadge(r.pending)}</p>
    <p class="run-card-meta muted"><span class="mono">${r.id}</span> · ${r.stage_label} · <time datetime="${r.updated_at}">${ago(r.updated_at)}</time> · ${r.score === null ? 'Not scored' : `Score ${r.score}`}</p>
  </li>`;
}

function row(r: RunSummary): Raw {
  return html`<tr>
    <th scope="row"><a class="run-name" href="/runs/${r.id}">${r.name}</a><span class="run-id mono">${r.id}</span></th>
    <td class="col-fit">${r.stage_label}</td>
    <td class="col-fit"><span class="badges">${statusBadge(r.status)}${pendingBadge(r.pending)}</span></td>
    <td class="num col-fit">${score(r)}</td>
    <td class="col-fit muted"><time datetime="${r.updated_at}">${ago(r.updated_at)}</time></td>
    <td class="col-action">${remove(r)}</td>
  </tr>`;
}

class RunList extends Component<RunSummary[]> {
  protected render(runs: RunSummary[]): void {
    if (!runs.length) {
      this.paint(html`<p class="empty">No runs yet. Start one with <button type="button" class="text-link" data-start-new>New run</button>.</p>`);
      return;
    }
    this.paint(html`
      <div class="table-wrap runs-wide">
        <table class="runs-table">
          <caption class="sr-only">Runs, most recently updated first</caption>
          <thead><tr><th scope="col">Project</th><th scope="col">Stage</th><th scope="col">Status</th><th scope="col" class="num">Score</th><th scope="col">Updated</th><th scope="col" class="col-action"><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>${runs.map(row)}</tbody>
        </table>
      </div>
      <ol class="run-cards" aria-label="Runs, most recently updated first">${runs.map(card)}</ol>`);
  }
}

customElements.define('run-list', RunList);
