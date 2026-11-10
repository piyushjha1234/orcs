// New run. Each field shows its own error, and a summary at the top takes focus when the form cannot be sent.
// Skills are searched on demand. Global skills default to No.
// The CLI asks for both in one line. This form keeps them separate, which is easier on a phone.
import { api, ApiError } from '../lib/api.ts';
import { pendingFolder } from '../lib/folder-dialog.ts';
import { html, type Raw } from '../lib/dom.ts';
import { plural } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import { SKILL_SOURCE } from './shared.ts';

const SKILL_WARNING = 'Skills can run code. Add only sources you trust.';
const GLOBAL_WARNING = 'Adds about 2k tokens to every agent turn.';

interface Problem {
  field?: 'name' | 'requirements' | 'skills' | 'dir';
  message: string;
}

const TARGET: Record<Exclude<NonNullable<Problem['field']>, 'dir'>, string> = {
  name: 'nr-name',
  requirements: 'nr-req',
  skills: 'nr-skill-q',
};

const ERROR_ID: Record<NonNullable<Problem['field']>, string> = {
  name: 'nr-name-error',
  requirements: 'nr-req-error',
  skills: 'nr-skills-error',
  dir: 'nr-dir-error',
};

function message(err: unknown): string {
  return err instanceof Error ? err.message : 'The run was not started. Try again.';
}

function template(): Raw {
  return html`
    <form class="form" id="nr-form" novalidate>
      <div class="error-summary" id="nr-summary" role="alert" tabindex="-1" hidden>
        <h2>Fix these to start the run</h2>
        <ul id="nr-summary-list"></ul>
      </div>

      <div class="field">
        <label for="nr-name">Project name</label>
        <p class="hint" id="nr-name-hint">Keep it under 80 characters.</p>
        <input id="nr-name" name="name" type="text" autocomplete="off" required aria-describedby="nr-name-hint nr-name-error">
        <p class="error" id="nr-name-error" hidden></p>
      </div>

      <div class="field">
        <label for="nr-req">What should it do?</label>
        <p class="hint" id="nr-req-hint">The product, who uses it, and what counts as done.</p>
        <textarea id="nr-req" name="requirements" rows="8" required aria-describedby="nr-req-hint nr-req-error"></textarea>
        <p class="error" id="nr-req-error" hidden></p>
      </div>

      <fieldset class="field" aria-describedby="nr-skills-error">
        <legend>Skills <span class="optional">optional</span> <warning-tip id="nr-skills-warn" label="Skills warning">${SKILL_WARNING}</warning-tip></legend>
        <div class="search-row">
          <label for="nr-skill-q">Search skills</label>
          <div class="search-controls">
            <input id="nr-skill-q" type="search" autocomplete="off" aria-describedby="nr-skill-status">
            <button type="button" class="btn" data-search>Search</button>
          </div>
        </div>
        <p class="field-note" id="nr-skill-status"></p>
        <ul class="found" id="nr-found"></ul>
        <h3 class="sub" id="nr-added-title">Added</h3>
        <ul class="added" id="nr-added" aria-labelledby="nr-added-title" tabindex="-1"></ul>
        <p class="error" id="nr-skills-error" hidden></p>
      </fieldset>

      <fieldset class="field">
        <legend>Use your global skills too? <warning-tip id="nr-global-warn" label="Global skills warning">${GLOBAL_WARNING}</warning-tip></legend>
        <div class="choices">
          <label class="choice"><input type="radio" name="global" value="no" checked> No</label>
          <label class="choice"><input type="radio" name="global" value="yes"> Yes</label>
        </div>
      </fieldset>

      <div class="actions">
        <button type="submit" class="btn btn-primary" id="nr-submit">Start run</button>
      </div>
    </form>`;
}

class NewRunForm extends HTMLElement {
  #skills: string[] = [];
  #found: { source: string; installs: string }[] = [];
  #query = '';
  #busy = false;

  constructor() {
    super();
    // Listeners are attached once here, so re-attaching the element never doubles them.
    this.addEventListener('submit', this.#onSubmit);
    this.addEventListener('click', this.#onClick);
    this.addEventListener('keydown', this.#onKey);
  }

  connectedCallback(): void {
    if (this.childElementCount) return;
    this.innerHTML = template().value;
    this.#renderSkills();
  }

  #el<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.querySelector<T>(`#${id}`) as T;
  }

  #onKey = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement).id === 'nr-skill-q' && e.key === 'Enter') {
      e.preventDefault();
      void this.#search();
    }
  };

  #onClick = (e: Event): void => {
    const target = e.target as HTMLElement;
    const add = target.closest<HTMLElement>('[data-add]');
    const remove = target.closest<HTMLElement>('[data-remove]');
    if (target.closest('[data-search]')) void this.#search();
    else if (add) this.#add(add.dataset.add ?? '');
    else if (remove) this.#remove(remove.dataset.remove ?? '');
  };

  async #search(): Promise<void> {
    const q = this.#el<HTMLInputElement>('nr-skill-q').value.trim();
    const status = this.#el('nr-skill-status');
    this.#query = q;
    if (!q) {
      status.textContent = 'Type a name or owner/repo to search.';
      return;
    }
    status.textContent = 'Searching…';
    try {
      const { skills } = await api.skills(q);
      this.#found = skills;
      status.textContent = skills.length
        ? `${plural(skills.length, 'skill', 'skills')} found for “${q}”.`
        : `No skills found for “${q}”.`;
      this.#clearSkillError();
      this.#renderFound();
    } catch (err) {
      this.#found = [];
      status.textContent = '';
      this.#showSkillError(message(err));
      this.#renderFound();
    }
  }

  #add(source: string): void {
    if (!source || this.#skills.includes(source)) return;
    this.#skills.push(source);
    this.#clearSkillError();
    this.#renderSkills();
    this.#el('nr-skill-status').textContent = `Added ${source}.`;
  }

  #remove(source: string): void {
    this.#skills = this.#skills.filter((s) => s !== source);
    this.#renderSkills();
    this.#el('nr-skill-status').textContent = `Removed ${source}.`;
    this.#el('nr-added').focus();
  }

  #renderFound(): void {
    const list = this.#el('nr-found');
    const rows = [...this.#found];
    if (SKILL_SOURCE.test(this.#query) && !rows.some((r) => r.source === this.#query)) {
      rows.unshift({ source: this.#query, installs: 'typed in' });
    }
    list.innerHTML = rows
      .map((r) => {
        const added = this.#skills.includes(r.source);
        const action = added
          ? html`<span class="muted">Added</span>`
          : html`<button type="button" class="btn btn-quiet" data-add="${r.source}">Add<span class="sr-only"> ${r.source}</span></button>`;
        return html`<li class="found-row"><span class="mono">${r.source}</span> <span class="muted">${r.installs}</span> ${action}</li>`.value;
      })
      .join('');
  }

  #renderSkills(): void {
    const list = this.#el('nr-added');
    list.innerHTML = this.#skills.length
      ? this.#skills
          .map((s) => html`<li class="added-row"><span class="mono">${s}</span> <button type="button" class="btn btn-quiet" data-remove="${s}">Remove<span class="sr-only"> ${s}</span></button></li>`.value)
          .join('')
      : '<li class="muted">None added yet.</li>';
  }

  #showSkillError(text: string): void {
    const el = this.#el('nr-skills-error');
    el.textContent = text;
    el.hidden = false;
  }

  #clearSkillError(): void {
    this.#el('nr-skills-error').hidden = true;
  }

  #validate(): Problem[] {
    const name = this.#el<HTMLInputElement>('nr-name').value.trim();
    const req = this.#el<HTMLTextAreaElement>('nr-req').value.trim();
    const out: Problem[] = [];
    if (!name) out.push({ field: 'name', message: 'Give the project a name.' });
    else if (name.length > 80) out.push({ field: 'name', message: 'Keep the name under 80 characters.' });
    if (!req) out.push({ field: 'requirements', message: 'Describe what the project should do.' });
    return out;
  }

  #show(problems: Problem[]): void {
    for (const id of ['nr-name', 'nr-req']) {
      this.#el(id).setAttribute('aria-invalid', 'false');
    }
    for (const id of ['nr-name-error', 'nr-req-error']) {
      this.#el(id).hidden = true;
    }
    this.#clearSkillError();
    const summary = this.#el('nr-summary');
    const list = this.#el('nr-summary-list');
    list.innerHTML = '';
    for (const p of problems) {
      if (p.field && p.field !== 'dir') {
        const err = this.#el(ERROR_ID[p.field]);
        err.textContent = p.message;
        err.hidden = false;
        if (p.field !== 'skills') this.#el(TARGET[p.field]).setAttribute('aria-invalid', 'true');
      }
      const item = p.field && p.field !== 'dir'
        ? html`<li><a href="#${TARGET[p.field]}">${p.message}</a></li>`
        : html`<li>${p.message}</li>`;
      list.insertAdjacentHTML('beforeend', item.value);
    }
    summary.hidden = problems.length === 0;
    if (problems.length) summary.focus();
  }

  #onSubmit = (e: Event): void => {
    e.preventDefault();
    void this.#submit();
  };

  async #submit(): Promise<void> {
    if (this.#busy) return;
    const problems = this.#validate();
    if (problems.length) {
      this.#show(problems);
      return;
    }
    this.#show([]);
    const name = this.#el<HTMLInputElement>('nr-name').value.trim();
    const requirements = this.#el<HTMLTextAreaElement>('nr-req').value.trim();
    const global = (this.querySelector<HTMLInputElement>('input[name="global"]:checked')?.value ?? 'no') === 'yes';
    const button = this.#el<HTMLButtonElement>('nr-submit');
    this.#busy = true;
    button.disabled = true;
    button.textContent = 'Starting…';
    try {
      const dir = pendingFolder();
      if (!dir) {
        this.#show([{ message: 'Choose a project folder from New run.' }]);
        return;
      }
      const { id } = await api.createRun({ name, requirements, skills: this.#skills.join(','), global_skills: global, dir });
      await navigate(`/runs/${id}`);
    } catch (err) {
      const field = err instanceof ApiError ? err.field : undefined;
      const problem: Problem = { message: message(err) };
      if (field === 'name' || field === 'requirements' || field === 'skills' || field === 'dir') problem.field = field;
      this.#show([problem]);
    } finally {
      this.#busy = false;
      button.disabled = false;
      button.textContent = 'Start run';
    }
  }
}

if (!customElements.get('new-run-form')) customElements.define('new-run-form', NewRunForm);
