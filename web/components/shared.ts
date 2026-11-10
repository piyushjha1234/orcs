// Wording, status helpers and small building blocks used by more than one component.
import type { RunSummary, RunView } from '../../src/server/model.ts';
import type { Risk } from '../../src/types.ts';
import { html, raw, type Part, type Raw } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import { brief, plural } from '../lib/format.ts';

export const STATUS_LABEL: Record<RunView['status'], string> = {
  running: 'Running',
  waiting: 'Waiting',
  stopped: 'Stopped',
  failed: 'Failed',
  done: 'Done',
};

// Formula first, then one line of context. Shown in the info tips beside the numbers.
export const FORMULA = {
  tokens: { formula: 'input + output + cache write + 0.1 × cache read', note: 'Cache reads count at a tenth.' },
  cost: { formula: 'Σ turns (tokens × USD per 1M) ÷ 1,000,000', note: 'Uses the price Claude reports when it has one.' },
  score: { formula: 'Σ (factor × weight) ÷ Σ weights × 100', note: 'Capped at 60 if a requirement fails.' },
} as const;

export function infoTip(label: string, f: { formula: string; note: string }): Raw {
  return html`<warning-tip kind="info" label="${label}" formula="${f.formula}">${f.note}</warning-tip>`;
}

export function statusLine(run: RunView): string {
  if (run.status === 'done') return 'Finished. The report is ready.';
  if (run.status === 'failed') return `Failed: ${brief(run.error ?? 'See the activity below.', 2)}`;
  if (run.status === 'stopped') return run.error ? `Stopped. ${brief(run.error, 2)}` : 'Stopped.';
  if (run.pending.length) return plural(run.pending.length, 'question needs you.', 'questions need you.');
  if (!run.active) return 'Not running. Resume to continue.';
  return 'Nothing needs you right now.';
}

export function statusBadge(status: RunView['status'] | RunSummary['status']): Raw {
  return html`<span class="status status-${status}"><span class="dot" aria-hidden="true"></span>${STATUS_LABEL[status]}</span>`;
}

export function pendingBadge(count: number): Raw {
  if (!count) return raw('');
  return html`<span class="badge">${icon('bolt', 14)}${plural(count, 'question needs you', 'questions need you')}</span>`;
}

export function riskBadge(risk: Risk): Raw {
  return html`<span class="status risk-${risk}">${risk[0].toUpperCase()}${risk.slice(1)} risk</span>`;
}

// A label and value list. Rows with an empty value are left out.
export function facts(rows: [string, Part][]): Raw {
  const shown = rows.filter(([, v]) => v !== '' && v !== null && v !== undefined && !(Array.isArray(v) && !v.length));
  return html`<dl class="facts">${shown.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
}

// A table inside a labelled, focusable scroll region, so a wide table never makes the page scroll sideways.
export function tableRegion(id: string, caption: string, head: string[], rows: Raw[], numeric: number[] = [], showCaption = true): Raw {
  const th = head.map((h, i) => html`<th scope="col"${numeric.includes(i) ? raw(' class="num"') : raw('')}>${h}</th>`);
  return html`<div class="table-wrap" role="region" aria-labelledby="${id}" tabindex="0"><table>
    <caption id="${id}"${showCaption ? raw('') : raw(' class="sr-only"')}>${caption}</caption>
    <thead><tr>${th}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

export const SKILL_SOURCE = /^[\w.-]+\/[\w.-]+(@[\w.:-]+)?$/;
