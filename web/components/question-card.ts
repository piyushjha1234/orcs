// One question from the agents. Numbers 1 to 9 pick an option, Enter sends, and a typed answer wins over the picked option.
// The card only re-renders when the question changes, so typed text is kept while the page updates.
import type { Question } from '../../src/types.ts';
import { api, ApiError } from '../lib/api.ts';
import { announce } from '../lib/a11y.ts';
import { Component } from '../lib/component.ts';
import { html, raw, type Raw } from '../lib/dom.ts';

export interface QuestionInput {
  runId: string;
  question: Question;
}

const WHO: Record<string, string> = { orcs: 'orcs', analyst: 'the analyst', architect: 'the architect', tester: 'the tester', developers: 'the developers' };

function who(from: string): string {
  return WHO[from] ?? `developer ${from}`;
}

class QuestionCard extends Component<QuestionInput> {
  #qid = '';

  constructor() {
    super();
    // Registered once, here, so a re-render never adds a second handler.
    this.addEventListener('submit', this.#onSubmit);
    this.addEventListener('keydown', this.#onKey);
  }

  protected render({ runId, question: q }: QuestionInput): void {
    if (q.id === this.#qid) return;
    this.#qid = q.id;
    const base = `q-${runId}-${q.id}`;
    const count = q.options.length;
    const picked = count ? (q.recommended >= 1 && q.recommended <= count ? q.recommended : 1) : 0;
    const options = q.options.map((o, i): Raw => {
      const n = i + 1;
      const rec = n === q.recommended ? raw('<span class="tag">recommended</span>') : raw('');
      return html`<label class="option" for="${base}-${n}">
        <input type="radio" id="${base}-${n}" name="choice" value="${n}"${n === picked ? raw(' checked') : raw('')}>
        <span class="opt-n mono" aria-hidden="true">${n}</span><span class="opt-text">${o}</span>${rec}
      </label>`;
    });
    const keys = count > 1 ? html` · press <kbd>1</kbd>–<kbd>${Math.min(count, 9)}</kbd> to pick` : raw('');
    const details = q.details?.length ? html`<ul class="details">${q.details.map((d) => html`<li>${d}</li>`)}</ul>` : raw('');
    this.paint(html`
      <form class="question" novalidate data-qid="${q.id}">
        <fieldset class="question-fields">
          <legend class="question-text">${q.text}</legend>
          <p class="question-meta">From ${who(q.from)}${keys}</p>
          ${details}
          ${count ? html`<div class="options">${options}</div>` : raw('')}
        </fieldset>
        <div class="field answer-field">
          <label for="${base}-text">${count ? 'Or write your own answer' : 'Your answer'}</label>
          <textarea id="${base}-text" name="text" rows="2" autocomplete="off"${count ? raw('') : raw(' required')}></textarea>
        </div>
        <p class="error" id="${base}-error" role="alert" hidden></p>
        <div class="actions"><button type="submit" class="btn btn-primary" data-send>Send answer</button></div>
      </form>`);
    this.dataset.run = runId;
  }

  #onSubmit = (e: Event): void => {
    e.preventDefault();
    void this.send();
  };

  #onKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLTextAreaElement) return;
    if (/^[1-9]$/.test(e.key)) {
      const radio = this.querySelector<HTMLInputElement>(`input[type="radio"][value="${e.key}"]`);
      if (!radio) return;
      e.preventDefault();
      radio.checked = true;
      radio.focus();
      return;
    }
    const onChoice = (target instanceof HTMLInputElement && target.type === 'radio') || target instanceof HTMLFieldSetElement;
    if (e.key === 'Enter' && onChoice) {
      e.preventDefault();
      this.querySelector('form')?.requestSubmit();
    }
  };

  private showError(message: string): void {
    const el = this.querySelector<HTMLElement>('.error');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    this.querySelector<HTMLTextAreaElement | HTMLInputElement>('textarea')?.focus();
  }

  async send(): Promise<void> {
    const form = this.querySelector('form');
    const runId = this.dataset.run ?? '';
    if (!form || !this.#qid) return;
    const typed = (form.querySelector('textarea')?.value ?? '').trim();
    const choice = form.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value ?? '';
    const answer = typed || choice;
    if (!answer) {
      this.showError('Pick an option or type an answer.');
      return;
    }
    const button = form.querySelector<HTMLButtonElement>('[data-send]');
    if (button) {
      button.disabled = true;
      button.textContent = 'Sending…';
    }
    try {
      await api.answer(runId, this.#qid, answer);
      announce('Answer sent.');
      this.dispatchEvent(new CustomEvent('answered', { bubbles: true, detail: { id: this.#qid } }));
    } catch (err) {
      if (button) {
        button.disabled = false;
        button.textContent = 'Send answer';
      }
      this.showError(err instanceof ApiError ? err.message : 'The answer was not sent. Try again.');
    }
  }
}

customElements.define('question-card', QuestionCard);
