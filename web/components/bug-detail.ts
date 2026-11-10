// One bug, with the steps to reproduce it and the evidence the tester recorded.
import type { Architecture, Bug } from '../../src/types.ts';
import { Component } from '../lib/component.ts';
import { html, raw } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import { where } from './bug-list.ts';
import { facts, riskBadge } from './shared.ts';

export interface BugDetailInput {
  runId: string;
  bug: Bug;
  arch?: Architecture | null;
}

class BugDetail extends Component<BugDetailInput> {
  protected render({ runId, bug: b, arch }: BugDetailInput): void {
    const state = b.status === 'open'
      ? html`<span class="status status-waiting">Open</span>`
      : html`<span class="status status-done">Fixed</span>`;
    this.paint(html`
      <p class="back"><a href="/runs/${runId}/bugs">${icon('back', 16)}Back to bugs</a></p>
      <h2 data-focus>${b.title}</h2>
      <p class="badges"><span class="mono muted">${b.id}</span>${riskBadge(b.risk)}${state}</p>
      ${facts([
        ['Where', where(b, arch) || 'Not known'],
        ['Requirement', b.br !== 'none' ? html`<span class="mono">${b.br}</span>` : 'Not tied to a requirement'],
        ['File', b.file ? html`<span class="mono">${b.file}</span>` : ''],
        ['Expected', b.expected],
        ['Actual', b.actual],
      ])}
      <h3>Steps</h3>
      <ol class="steps">${b.steps.map((s) => html`<li>${s}</li>`)}</ol>
      ${b.evidence
        ? html`<h3>Evidence</h3><div class="evidence" role="region" aria-label="Evidence for ${b.id}" tabindex="0"><pre>${b.evidence}</pre></div>`
        : raw('')}`);
  }
}

customElements.define('bug-detail', BugDetail);
