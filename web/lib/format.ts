// Formatting shared with the CLI, so a number or a status reads the same on the phone and in the terminal.
export { tokens, money, minutes, short, brief, since, envLabel, WORD, STAGE } from '../../src/view.ts';
import { minutes } from '../../src/view.ts';

export function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = (Date.now() - Date.parse(iso)) / 60_000;
  if (diff < 1) return 'just now';
  if (diff < 60) return `${Math.round(diff)} min ago`;
  if (diff < 60 * 24) return `${Math.floor(diff / 60)} h ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function elapsed(createdAt: string, endedAt: string | null, waitMinutes = 0): string {
  const end = endedAt ? Date.parse(endedAt) : Date.now();
  return minutes((end - Date.parse(createdAt)) / 60_000 - waitMinutes);
}

// claude-sonnet-5-5 reads as Sonnet 5.5.
export function modelName(id: string): string {
  const [family = id, ...version] = id.replace(/^claude-/, '').split('-');
  return `${family[0].toUpperCase()}${family.slice(1)}${version.length ? ` ${version.join('.')}` : ''}`;
}

export const plural = (n: number, one: string, many: string): string => (n === 1 ? `${n} ${one}` : `${n} ${many}`);
