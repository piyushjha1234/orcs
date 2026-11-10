// A warning or info icon. The message shows on hover, focus, or tap, and stays out of the page until then.
// An optional formula attribute is shown above the message in mono. The bubble opens towards the side with room.
import { html, raw } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';

class WarningTip extends HTMLElement {
  #text = '';
  #ready = false;
  #bubbleId = '';

  constructor() {
    super();
    this.addEventListener('pointerenter', this.#place);
    this.addEventListener('focusin', this.#place);
    this.addEventListener('click', (e) => {
      if (!(e.target as Element).closest('.tip-btn')) return;
      this.#place();
      this.#setOpen(!this.classList.contains('is-open'));
    });
  }

  set text(value: string) {
    this.#text = value.trim();
    this.hidden = !this.#text;
    if (this.#ready) this.#paint();
  }

  connectedCallback(): void {
    if (!this.#text) this.#text = (this.textContent ?? '').trim();
    this.classList.add('tip');
    this.hidden = !this.#text && !this.getAttribute('formula');
    this.#ready = true;
    this.#paint();
  }

  #place = (): void => {
    const box = this.getBoundingClientRect();
    this.classList.toggle('tip-end', box.left + box.width / 2 > window.innerWidth / 2);
  };

  #paint(): void {
    if (!this.#bubbleId) this.#bubbleId = this.id ? `${this.id}-tip` : `tip-${Math.random().toString(36).slice(2, 10)}`;
    const id = this.#bubbleId;
    const info = this.getAttribute('kind') === 'info';
    const formula = this.getAttribute('formula') ?? '';
    this.classList.toggle('tip-info', info);
    const label = this.getAttribute('label') || (info ? 'Info' : 'Warning');
    this.innerHTML = html`<button type="button" class="tip-btn" aria-label="${label}" aria-describedby="${id}" aria-expanded="false">${icon(info ? 'info' : 'warn', 16)}</button><span class="tip-bubble" id="${id}" role="tooltip">${formula ? html`<code class="tip-formula">${formula}</code>` : raw('')}${this.#text ? html`<span class="tip-text">${this.#text}</span>` : raw('')}</span>`.value;
  }

  #setOpen(open: boolean): void {
    this.classList.toggle('is-open', open);
    this.querySelector('button')?.setAttribute('aria-expanded', String(open));
  }
}

function closeTip(tip: Element): void {
  tip.classList.remove('is-open');
  tip.querySelector('button')?.setAttribute('aria-expanded', 'false');
}

document.addEventListener('click', (e) => {
  for (const tip of document.querySelectorAll('warning-tip.is-open')) {
    if (!tip.contains(e.target as Node)) closeTip(tip);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  for (const tip of document.querySelectorAll('warning-tip.is-open')) closeTip(tip);
});

if (!customElements.get('warning-tip')) customElements.define('warning-tip', WarningTip);
