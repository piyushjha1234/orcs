// The orcs.ai wordmark, used in the header.
import { html } from '../lib/dom.ts';

class OrcsBrand extends HTMLElement {
  connectedCallback(): void {
    if (this.childElementCount) return;
    this.innerHTML = html`<a class="brand" href="/">orcs<span class="brand-ai">.ai</span></a>`.value;
  }
}

customElements.define('orcs-brand', OrcsBrand);
