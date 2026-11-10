// Inline SVG icons. They are decoration only: every icon sits next to text, so it is hidden from assistive tech.
import { raw, type Raw } from './dom.ts';

const PATHS: Record<string, string> = {
  waiting: '<circle cx="12" cy="12" r="8"/>',
  building: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>',
  checking: '<circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/>',
  fixing: '<path d="M4.5 12a7.5 7.5 0 0 1 13-5.1M19.5 12a7.5 7.5 0 0 1-13 5.1"/><path d="M18 3.5v3.8h-3.8M6 20.5v-3.8h3.8"/>',
  blocked: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.01"/>',
  merged: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  failed: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  question: '<path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7v.5"/><path d="M12 17.5v.01"/><circle cx="12" cy="12" r="8.5"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>',
  bin: '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M7 7l1 13h8l1-13"/><path d="M10 11v6M14 11v6"/>',
  plan: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
  progress: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  bug: '<rect x="7" y="7" width="10" height="13" rx="5"/><path d="M12 11v9M7 12H3M21 12h-4M7 17l-3 2M17 17l3 2M8 8L5 5M16 8l3-3M9.5 7a2.5 2.5 0 0 1 5 0"/>',
  report: '<path d="M4 20h16"/><path d="M7 16v-5M12 16V6M17 16v-8"/>',
  maximise: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  minimise: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
};

export function icon(name: keyof typeof PATHS | string, size = 18): Raw {
  const body = PATHS[name] ?? '';
  return raw(
    `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`,
  );
}
