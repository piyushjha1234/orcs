// Where the run is, in six plain steps. The current step is marked for screen readers with aria-current.
import type { Stage } from '../../src/types.ts';
import { Component } from '../lib/component.ts';
import { html, raw, type Raw } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';

export const GROUPS: [string, Stage[]][] = [
  ['Requirement', ['analyst', 'skills']],
  ['Architecture', ['architect']],
  ['Build', ['build']],
  ['Test', ['test']],
  ['Bugs', ['bugs', 'fix']],
  ['Finish', ['accept', 'rating', 'finish', 'done']],
];

export class RunStepper extends Component<Stage> {
  protected render(stage: Stage): void {
    const found = GROUPS.findIndex(([, stages]) => stages.includes(stage));
    const current = stage === 'done' ? GROUPS.length : Math.max(0, found);
    const items = GROUPS.map(([name], i): Raw => {
      const state = i < current ? 'past' : i === current ? 'now' : 'next';
      const now = i === current ? raw(' aria-current="step"') : raw('');
      const mark = i < current ? icon('check', 14) : raw(`<span class="step-num mono">${i + 1}</span>`);
      const spoken = i < current ? '(done)' : i === current ? '(current)' : '(next)';
      return html`<li class="step step-${state}"${now}><span class="step-mark">${mark}</span><span class="step-name">${name}</span><span class="sr-only"> ${spoken}</span></li>`;
    });
    this.paint(html`<ol class="stepper" aria-label="Run progress">${items}</ol>`);
  }
}

customElements.define('run-stepper', RunStepper);
