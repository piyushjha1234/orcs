// Open bugs grouped by risk. Risk is written out in words, so colour is never the only signal.
import type { Architecture, Bug, Risk } from '../../src/types.ts';
import { Component } from '../lib/component.ts';
import { html, raw, type Raw } from '../lib/dom.ts';
import { envLabel, plural } from '../lib/format.ts';
import { icon } from '../lib/icons.ts';
import { riskBadge } from './shared.ts';

export interface BugListInput {
  runId: string;
  bugs: Bug[];
  arch?: Architecture | null;
}

const RISKS: Risk[] = ['high', 'medium', 'low'];

export function where(b: Bug, arch?: Architecture | null): string {
  return [b.type, envLabel(arch ?? undefined, b.env)].filter(Boolean).join(' · ');
}

class BugList extends Component<BugListInput> {
  protected render({ runId, bugs, arch }: BugListInput): void {
    const open = bugs.filter((b) => b.status === 'open');
    const fixed = bugs.length - open.length;
    const note = fixed ? html`<p class="hint">${plural(fixed, 'bug was fixed.', 'bugs were fixed.')}</p>` : raw('');
    if (!open.length) {
      this.paint(html`<p class="empty">No open bugs.</p>${note}`);
      return;
    }
    const groups = RISKS.map((risk): Raw => {
      const list = open.filter((b) => b.risk === risk);
      if (!list.length) return raw('');
      return html`<section class="bug-group" aria-labelledby="risk-${risk}">
        <h3 id="risk-${risk}" class="group-head">${riskBadge(risk)}<span class="muted">${plural(list.length, 'bug', 'bugs')}</span></h3>
        <ul class="rows">${list.map((b) => html`<li class="bug-row">
          <a href="/runs/${runId}/bugs/${b.id}"><span class="mono bug-id">${b.id}</span><span class="bug-title">${b.title}</span>${icon('arrow', 16)}</a>
          <span class="meta">${where(b, arch)}</span>
        </li>`)}</ul>
      </section>`;
    });
    const counts = RISKS.map((r) => `${open.filter((b) => b.risk === r).length} ${r}`).join(', ');
    this.paint(html`<p class="meta">${plural(open.length, 'open bug', 'open bugs')}: ${counts}.</p>${groups}${note}`);
  }
}

customElements.define('bug-list', BugList);
