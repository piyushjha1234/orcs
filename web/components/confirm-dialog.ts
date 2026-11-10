// A native <dialog> that asks one question. It resolves to true only when the confirm button is chosen.
// Escape and Cancel both resolve to false. Focus returns to the button that opened it.
import { html } from '../lib/dom.ts';

export interface ConfirmOptions {
  title: string;
  body: string;
  confirm: string;
  cancel?: string;
  danger?: boolean;
}

export function askConfirm(o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    dialog.setAttribute('aria-labelledby', 'confirm-title');
    dialog.setAttribute('aria-describedby', 'confirm-body');
    dialog.innerHTML = html`<form method="dialog" class="dialog-form">
      <h2 id="confirm-title">${o.title}</h2>
      <p id="confirm-body">${o.body}</p>
      <div class="actions">
        <button type="submit" value="cancel" class="btn"${o.danger ? ' autofocus' : ''}>${o.cancel ?? 'Cancel'}</button>
        <button type="submit" value="confirm" class="btn ${o.danger ? 'btn-danger' : 'btn-primary'}">${o.confirm}</button>
      </div>
    </form>`.value;
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'confirm');
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}
