// The approved plan: requirement, architecture, tasks and the flow. The flow is drawn as SVG, and the same links are listed for screen readers.
import type { Architecture, Requirement } from '../../src/types.ts';
import { Component } from '../lib/component.ts';
import { html, raw, type Raw } from '../lib/dom.ts';
import { facts, tableRegion } from './shared.ts';

export interface PlanInput {
  requirement: Requirement | null;
  architecture: Architecture | null;
}

function name(arch: Architecture, id: string): string {
  return arch.flow.steps.find((s) => s.id === id)?.label ?? id;
}

// Flow layout. Steps sit in one centred column, all the same width. A link to the next step is a straight arrow;
// a link that skips ahead curves round the right, and a link back curves round the left, each in its own lane.
const NODE_H = 44;
const GAP = 52;
const PAD = 12;
const LEAD = 44;
const CHAR = 7.4;
const LABEL_CHAR = 6.6;
const MAX_CHARS = 36;
const HUES = 6;

interface Link { from: string; to: string; label: string; a: number; b: number }

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const labelWidth = (s: string): number => (s ? s.length * LABEL_CHAR + 8 : 0);

function flow(arch: Architecture): Raw {
  const steps = arch.flow.steps;
  if (!steps.length) return raw('');
  const index = new Map(steps.map((s, i) => [s.id, i]));
  const links: Link[] = arch.flow.links
    .filter((l) => index.has(l.from) && index.has(l.to) && l.from !== l.to)
    .map((l) => ({ ...l, label: clip(l.label ?? '', 28), a: index.get(l.from)!, b: index.get(l.to)! }));
  const longest = Math.max(...steps.map((s) => Math.min(s.label.length, MAX_CHARS)), 12);
  const w = Math.round(longest * CHAR + LEAD + 20);

  const ahead = links.filter((l) => l.b > l.a + 1).sort((p, q) => p.b - p.a - (q.b - q.a));
  const back = links.filter((l) => l.b < l.a).sort((p, q) => p.a - p.b - (q.a - q.b));
  const straight = links.filter((l) => l.b === l.a + 1);
  const lane = new Map<Link, number>([...ahead.map((l, i) => [l, i] as const), ...back.map((l, i) => [l, i] as const)]);
  const bulge = (l: Link): number => 32 + (lane.get(l) ?? 0) * 22;
  const sideNeed = (list: Link[]): number => Math.max(0, ...list.map((l) => bulge(l) * 0.75 + (l.label ? labelWidth(l.label) + 6 : 0)));
  const straightNeed = Math.max(0, ...straight.map((l) => 12 + labelWidth(l.label) - w / 2));
  const side = Math.ceil(Math.max(sideNeed(ahead), sideNeed(back), straightNeed)) + PAD;

  const width = side * 2 + w;
  const x0 = side;
  const cx = side + w / 2;
  const y = (i: number): number => PAD + i * (NODE_H + GAP);
  const height = y(steps.length - 1) + NODE_H + PAD;
  const hue = (i: number): number => i % HUES;

  const edges = links.map((l) => {
    const h = hue(l.a);
    const ya = y(l.a) + NODE_H / 2;
    const yb = y(l.b) + NODE_H / 2;
    const mid = (ya + yb) / 2;
    let d: string;
    let label: Raw = raw('');
    if (l.b === l.a + 1) {
      d = `M${cx} ${y(l.a) + NODE_H} L${cx} ${y(l.b) - 1}`;
      if (l.label) label = html`<text class="edge-label" x="${cx + 12}" y="${(y(l.a) + NODE_H + y(l.b)) / 2}">${l.label}</text>`;
    } else {
      const dir = l.b > l.a ? 1 : -1;
      const edge = dir > 0 ? x0 + w : x0;
      const out = edge + dir * bulge(l);
      d = `M${edge} ${ya} C${out} ${ya}, ${out} ${yb}, ${edge + dir * 2} ${yb}`;
      if (l.label) {
        const lx = edge + dir * (bulge(l) * 0.75 + 6);
        label = html`<text class="edge-label" x="${lx}" y="${mid}"${dir < 0 ? raw(' text-anchor="end"') : raw('')}>${l.label}</text>`;
      }
    }
    return html`<g class="edge hue-${h}"><path d="${d}" marker-end="url(#flow-arrow-${h})"/>${label}</g>`;
  });

  const nodes = steps.map((s, i) => {
    const top = y(i);
    const terminal = steps.length > 1 && (i === 0 || i === steps.length - 1);
    const text = clip(s.label, MAX_CHARS);
    return html`<g class="node hue-${hue(i)}">
      ${text !== s.label ? html`<title>${s.label}</title>` : raw('')}
      <rect x="${x0}" y="${top}" width="${w}" height="${NODE_H}" rx="${terminal ? NODE_H / 2 : 10}"/>
      <circle class="node-n" cx="${x0 + 22}" cy="${top + NODE_H / 2}" r="11"/>
      <text class="node-n-text" x="${x0 + 22}" y="${top + NODE_H / 2}">${i + 1}</text>
      <text class="node-label" x="${x0 + LEAD + (w - LEAD - 20) / 2}" y="${top + NODE_H / 2}">${text}</text>
    </g>`;
  });

  const used = Math.min(steps.length, HUES);
  const markers = Array.from({ length: used }, (_, h) => html`<marker id="flow-arrow-${h}" class="hue-${h}" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker>`);

  return html`<svg class="flow" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Flow with ${steps.length} steps" focusable="false">
    <defs>${markers}</defs>${edges}${nodes}
  </svg>`;
}

class PlanView extends Component<PlanInput> {
  protected render({ requirement: req, architecture: arch }: PlanInput): void {
    const parts: Raw[] = [html`<h2 data-focus>Plan</h2>`];
    if (req) {
      const t = req.targets;
      const targets = [...t.platforms, ...t.devices, ...t.browsers].join(', ') || 'None';
      parts.push(html`<section aria-labelledby="p-req"><h3 id="p-req">Requirement</h3>
        <p class="lead">${req.goal}</p>
        ${facts([
          ['Users', req.users.join(', ')],
          ['Not included', req.non_goals.join(', ')],
          ['Targets', t.expected_users ? `${targets}, ${t.expected_users} users` : targets],
        ])}
        ${tableRegion('p-brs', 'Requirements', ['Id', 'Requirement', 'Priority', 'Acceptance'],
          req.brs.map((b) => html`<tr><th scope="row" class="mono">${b.id}</th><td>${b.title}</td><td>${b.priority}</td><td>${b.ac.join(' ')}</td></tr>`))}
      </section>`);
    }
    if (arch) {
      const envs = arch.test_scope.matrix.map((e) => (e.browser === 'none' ? e.device : `${e.browser} on ${e.device}`)).join(', ');
      parts.push(html`<section aria-labelledby="p-arch"><h3 id="p-arch">Architecture</h3>
        ${facts(arch.stack.map((s): [string, Raw] => [s.layer, html`${s.choice} <span class="mono">${s.version}</span>${s.why ? html`<span class="fact-note">${s.why}</span>` : raw('')}`]))}
        ${tableRegion('p-tasks', `Tasks, up to ${arch.developers} at once`, ['Id', 'Task', 'Files', 'Needs'],
          arch.tasks.map((t) => html`<tr><th scope="row" class="mono">${t.id}</th><td>${t.title}</td><td class="mono">${t.files.join(', ')}</td><td class="mono">${t.deps.join(', ') || '–'}</td></tr>`))}
        ${facts([
          ['Tests', arch.test_scope.types.join(', ')],
          ['Environments', envs],
        ])}
        ${arch.flow.steps.length ? html`<h4>Flow</h4>
          <div class="flow-scroll" role="region" aria-label="Flow diagram" tabindex="0">${flow(arch)}</div>
          <ul class="sr-only">${arch.flow.links.map((l) => html`<li>${name(arch, l.from)} to ${name(arch, l.to)}${l.label ? `: ${l.label}` : ''}</li>`)}</ul>` : raw('')}
      </section>`);
    }
    if (!req && !arch) parts.push(html`<p class="empty">The plan appears once the analyst and architect finish.</p>`);
    this.paint(html`${parts}`);
  }
}

customElements.define('plan-view', PlanView);
