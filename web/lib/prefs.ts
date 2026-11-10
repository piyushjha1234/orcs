// Reader choices, kept in this browser only: theme and whether run updates are announced.
export type Theme = 'system' | 'light' | 'dark';

export interface Prefs {
  theme: Theme;
  announce: boolean;
}

const KEY = 'orcs.prefs';
const DEFAULTS: Prefs = { theme: 'system', announce: true };

export function prefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(next: Partial<Prefs>): void {
  localStorage.setItem(KEY, JSON.stringify({ ...prefs(), ...next }));
  applyTheme();
}

export function applyTheme(): void {
  const theme = prefs().theme;
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
}
