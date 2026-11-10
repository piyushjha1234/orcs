// Focus, titles and the one live region. Route changes move focus to the page heading, so screen readers start there.
import { prefs } from './prefs.ts';

const SITE = 'orcs.ai';

export function setTitle(part?: string): void {
  document.title = part ? `${part} · ${SITE}` : SITE;
}

// Only announces when the reader has not turned run updates off.
export function announce(message: string): void {
  if (!prefs().announce) return;
  const region = document.getElementById('status');
  if (!region) return;
  region.textContent = '';
  window.setTimeout(() => {
    region.textContent = message;
  }, 60);
}

// Moves focus to the section heading marked data-focus, or to the page h1.
export function focusHeading(root: ParentNode = document): void {
  const target = root.querySelector<HTMLElement>('[data-focus]') ?? root.querySelector<HTMLElement>('h1');
  if (!target) return;
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: false });
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
