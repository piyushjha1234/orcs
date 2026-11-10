// The model each agent runs on. Saved on this computer by orcs ui, so the CLI and every browser use the same choice.
// Loaded when the Settings dialog opens; each change is saved straight away.
import type { Role } from '../../src/types.ts';
import { api, type Settings } from '../lib/api.ts';
import { html } from '../lib/dom.ts';
import { modelName } from '../lib/format.ts';

const AGENT: Record<Role, string> = { analyst: 'Analyst', architect: 'Architect', developer: 'Developers', tester: 'Tester' };

export class ModelSettings extends HTMLElement {
  #busy = false;

  constructor() {
    super();
    this.addEventListener('change', (e) => {
      const select = (e.target as Element).closest<HTMLSelectElement>('select[data-role]');
      if (!select) return;
      e.stopPropagation();
      void this.#save(select);
    });
  }

  async load(): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    this.#status('');
    try {
      this.#paint(await api.settings());
    } catch (err) {
      this.innerHTML = html`<p class="error">Could not load models. ${err instanceof Error ? err.message : ''}</p>`.value;
    } finally {
      this.#busy = false;
    }
  }

  #paint(s: Settings): void {
    this.innerHTML = html`<div class="model-rows">${s.agents.map((a) => html`<div class="model-row">
      <label for="model-${a.role}">${AGENT[a.role]}</label>
      <select id="model-${a.role}" data-role="${a.role}" data-saved="${a.model}">
        <option value="">Default · ${modelName(a.default)}</option>
        ${s.models.map((m) => html`<option value="${m}"${m === a.model ? ' selected' : ''}>${modelName(m)}</option>`)}
      </select>
    </div>`)}</div>
    <p class="field-note" id="models-status" role="status"></p>`.value;
  }

  async #save(select: HTMLSelectElement): Promise<void> {
    const role = select.dataset.role as Role;
    select.disabled = true;
    this.#status('Saving…');
    try {
      await api.saveModels({ [role]: select.value });
      select.dataset.saved = select.value;
      const picked = select.selectedOptions[0]?.textContent ?? '';
      this.#status(`${AGENT[role]}: ${picked.replace(/^Default · /, '')} from the next session.`);
    } catch (err) {
      select.value = select.dataset.saved ?? '';
      this.#status(err instanceof Error ? err.message : 'Not saved. Try again.');
    } finally {
      select.disabled = false;
      select.focus();
    }
  }

  #status(text: string): void {
    const el = this.querySelector('#models-status');
    if (el) el.textContent = text;
  }
}

if (!customElements.get('model-settings')) customElements.define('model-settings', ModelSettings);
