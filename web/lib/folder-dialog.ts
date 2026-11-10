// The folder window is asked for before a new run, from the home page. The form itself does not ask again.
import { api } from './api.ts';
import { navigate } from './router.ts';

const KEY = 'orcs.pending-folder';

let chosen = '';
let wait: ((dir: string | null) => void) | null = null;
let wired = false;

export function pendingFolder(): string {
  return sessionStorage.getItem(KEY) ?? '';
}

export function wireFolderDialog(): void {
  if (wired) return;
  wired = true;
  const dialog = document.getElementById('folder-dialog') as HTMLDialogElement | null;
  const open = document.getElementById('folder-open') as HTMLButtonElement | null;
  if (!dialog || !open) return;
  open.addEventListener('click', () => void pick());
  dialog.addEventListener('close', () => {
    const dir = dialog.returnValue === 'go' ? chosen : null;
    if (dir) sessionStorage.setItem(KEY, dir);
    wait?.(dir);
    wait = null;
  });
}

export function askFolder(): Promise<string | null> {
  wireFolderDialog();
  const dialog = document.getElementById('folder-dialog') as HTMLDialogElement | null;
  if (!dialog) return Promise.resolve(null);
  if (dialog.open) return Promise.resolve(null);
  chosen = '';
  const path = document.getElementById('folder-path');
  const error = document.getElementById('folder-error');
  const go = document.getElementById('folder-go') as HTMLButtonElement | null;
  const open = document.getElementById('folder-open') as HTMLButtonElement | null;
  if (path) path.textContent = 'No folder yet';
  if (error) error.hidden = true;
  if (go) go.disabled = true;
  if (open) {
    open.disabled = false;
    open.textContent = 'Open';
  }
  dialog.returnValue = '';
  return new Promise((resolve) => {
    wait = resolve;
    dialog.showModal();
  });
}

export async function startNew(): Promise<void> {
  sessionStorage.removeItem(KEY);
  const dir = await askFolder();
  if (!dir) return;
  await navigate('/new');
}

async function pick(): Promise<void> {
  const open = document.getElementById('folder-open') as HTMLButtonElement | null;
  const error = document.getElementById('folder-error');
  const path = document.getElementById('folder-path');
  const go = document.getElementById('folder-go') as HTMLButtonElement | null;
  if (!open || open.disabled) return;
  open.disabled = true;
  open.textContent = 'Opening…';
  open.setAttribute('aria-busy', 'true');
  if (error) error.hidden = true;
  try {
    const { path: picked } = await api.pickFolder(chosen);
    if (picked) {
      chosen = picked;
      if (path) path.textContent = picked;
      if (go) go.disabled = false;
    }
  } catch (err) {
    if (error) {
      error.textContent = err instanceof Error ? err.message : 'The folder window could not open.';
      error.hidden = false;
    }
  } finally {
    open.disabled = false;
    open.textContent = 'Open';
    open.removeAttribute('aria-busy');
  }
}
