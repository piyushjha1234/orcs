// Escaped HTML templates. Every interpolated value is escaped unless it was built here with html`` or raw().

export class Raw {
  value: string;
  constructor(value: string) {
    this.value = value;
  }
}

export type Part = Raw | string | number | boolean | null | undefined | Part[];

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

export function raw(value: string): Raw {
  return new Raw(value);
}

function part(v: Part): string {
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(part).join('');
  if (v === null || v === undefined || typeof v === 'boolean') return '';
  return esc(v);
}

export function html(strings: TemplateStringsArray, ...values: Part[]): Raw {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += part(values[i]);
  });
  return new Raw(out);
}

export function text(v: Part): string {
  return part(v);
}

export function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function $$<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(selector)];
}
