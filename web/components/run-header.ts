// The top of every run page: name and status, stage, time and cost, the status line and the run's buttons.
// Buttons send a run-action event up to the page. Re-rendering only happens when the status changes,
// so a focused button is not replaced while the numbers update.
import type { RunView } from '../../src/server/model.ts';
import { Component } from '../lib/component.ts';
import { html, raw } from '../lib/dom.ts';
import { elapsed, money, STAGE, tokens } from '../lib/format.ts';
import { FORMULA, infoTip, statusBadge, statusLine } from './shared.ts';
import type { RunStepper } from './run-stepper.ts';

export const usageLine = (run: RunView): string => `${tokens(run.usage.effective)} tokens · ${money(run.usage.cost)}`;

class RunHeader extends Component<RunView> {
  #signature = '';

  protected render(run: RunView): void {
    const signature = [run.id, run.name, run.stage, run.status, run.active, run.error, run.pending.length, run.ended_at].join('|');
    if (signature !== this.#signature) {
      this.#signature = signature;
      this.paint(this.template(run));
    }
    const usage = this.querySelector('[data-usage]');
    if (usage) usage.textContent = usageLine(run);
    const clock = this.querySelector('[data-elapsed]');
    if (clock) clock.textContent = elapsed(run.created_at, run.ended_at);
    const stepper = this.querySelector<RunStepper>('run-stepper');
    if (stepper) stepper.data = run.stage;
  }

  private template(run: RunView) {
    const line = statusLine(run);
    const status = run.pending.length
      ? html`<p class="status-line status-line-ask"><a href="/runs/${run.id}/questions">${line}</a></p>`
      : html`<p class="status-line">${line}</p>`;
    const action = run.active
      ? html`<button type="button" class="btn btn-danger" data-action="stop">Stop run</button>`
      : run.stage !== 'done'
        ? html`<button type="button" class="btn btn-primary" data-action="resume">Resume run</button>`
        : raw('');
    const folder = run.project.split('/').pop() || run.project;
    return html`
      <div class="run-title"><h1>${run.name}</h1>${statusBadge(run.status)}</div>
      <p class="meta">
        <span class="meta-bit mono">${run.id}</span>
        <span class="meta-bit">${folder}</span>
        <span class="meta-bit">${STAGE[run.stage]}</span>
        <span class="meta-bit"><span class="sr-only">time so far </span><span data-elapsed>${elapsed(run.created_at, run.ended_at)}</span></span>
        <span class="meta-bit"><span data-usage>${usageLine(run)}</span>${infoTip('Cost formula', FORMULA.cost)}</span>
      </p>
      <div class="run-bar">${status}<div class="run-actions">${action}</div></div>
      <p class="alert" role="alert" data-alert hidden></p>
      <run-stepper></run-stepper>`;
  }
}

customElements.define('run-header', RunHeader);
