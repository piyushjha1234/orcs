// Entry point. Loads the components, applies the saved theme, wires the dialogs and shortcuts, then starts the router.
import './components/index.ts';
import type { ModelSettings } from './components/model-settings.ts';
import { icon } from './lib/icons.ts';
import { startNew, wireFolderDialog } from './lib/folder-dialog.ts';
import { navigate, start as startRouter } from './lib/router.ts';
import { applyTheme, prefs, savePrefs, type Theme } from './lib/prefs.ts';
import { registerPages } from './pages.ts';

function openDialog(id: string): void {
  const dialog = document.getElementById(id) as HTMLDialogElement | null;
  if (!dialog || dialog.open) return;
  dialog.showModal();
  void dialog.querySelector<ModelSettings>('model-settings')?.load();
}

function wireDialogs(): void {
  document.addEventListener('click', (e) => {
    const target = e.target as Element;
    if (target.closest('[data-start-new]')) {
      e.preventDefault();
      void startNew();
      return;
    }
    const opener = target.closest<HTMLElement>('[data-open]');
    if (opener?.dataset.open) openDialog(opener.dataset.open);
  });
}

function wireSettings(): void {
  const form = document.getElementById('settings-form') as HTMLFormElement | null;
  if (!form) return;
  const current = prefs();
  for (const input of form.querySelectorAll<HTMLInputElement>('input[name="theme"]')) {
    input.checked = input.value === current.theme;
  }
  const announceBox = form.querySelector<HTMLInputElement>('input[name="announce"]');
  if (announceBox) announceBox.checked = current.announce;
  form.addEventListener('change', () => {
    const theme = (form.querySelector<HTMLInputElement>('input[name="theme"]:checked')?.value ?? 'system') as Theme;
    savePrefs({ theme, announce: announceBox?.checked ?? true });
  });
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

// `?` opens help, `n` starts a run, and `g` then `r` goes to the runs list. Ignored while typing or inside a dialog.
function wireShortcuts(): void {
  let gAt = 0;
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target) || document.querySelector('dialog[open]')) return;
    if (e.key === '?') {
      e.preventDefault();
      openDialog('help-dialog');
      return;
    }
    if (e.key === 'r' && gAt && Date.now() - gAt < 1000) {
      gAt = 0;
      void navigate('/');
      return;
    }
    gAt = e.key === 'g' ? Date.now() : 0;
    if (e.key === 'n') {
      e.preventDefault();
      void startNew();
    }
  });
}

function wireScreen(): void {
  const button = document.getElementById('screen-size');
  if (!button) return;
  const paint = (): void => {
    const full = document.fullscreenElement !== null;
    button.setAttribute('aria-label', full ? 'Minimise' : 'Maximise');
    button.innerHTML = icon(full ? 'minimise' : 'maximise', 20).value;
  };
  button.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  });
  document.addEventListener('fullscreenchange', paint);
}

applyTheme();
wireDialogs();
wireScreen();
wireFolderDialog();
wireSettings();
wireShortcuts();
registerPages();
startRouter();
