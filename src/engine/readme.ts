import fs from 'node:fs';
import path from 'node:path';
import type { Architecture, Requirement } from '../types.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const START = '<!-- orcs:start -->';
const END = '<!-- orcs:end -->';

export function mermaid(flow: Architecture['flow']): string {
  const id = (s: string) => s.replace(/[^a-z0-9]/gi, '_');
  const label = (s: string) => s.replace(/"/g, "'").replace(/\s+/g, ' ').trim();
  return [
    'flowchart TD',
    ...flow.steps.map((s) => `  ${id(s.id)}["${label(s.label)}"]`),
    ...flow.links.map((l) => (l.label.trim()
      ? `  ${id(l.from)} -->|"${label(l.label)}"| ${id(l.to)}`
      : `  ${id(l.from)} --> ${id(l.to)}`)),
  ].join('\n');
}

function installSection(arch: Architecture): string {
  const s = arch.setup;
  const parts: string[] = [];
  if (s.runtime.trim()) parts.push(`You need ${s.runtime.trim()}.`);
  if (s.install.trim()) parts.push('```bash\n' + s.install.trim() + '\n```');
  if (s.env.length) parts.push('Set these environment variables:\n\n' + s.env.map((e) => `- \`${e.name}\`, for example \`${e.example}\``).join('\n'));
  return parts.join('\n\n');
}

function usageSection(arch: Architecture): string {
  const s = arch.setup;
  const parts: string[] = [];
  if (s.commands.start.trim()) parts.push('Start it:\n\n```bash\n' + s.commands.start.trim() + '\n```');
  if (s.url.trim()) parts.push(`Then open ${s.url.trim()}.`);
  if (arch.usage.length) parts.push(arch.usage.map((u, i) => `${i + 1}. ${u}`).join('\n'));
  return parts.join('\n\n');
}

export function renderReadme(name: string, req: Requirement, arch: Architecture): string {
  const install = installSection(arch);
  const template = fs.readFileSync(path.join(ROOT, 'templates', 'readme.md'), 'utf8');
  return template
    .replace(/\{\{#install\}\}\n?([\s\S]*?)\{\{\/install\}\}\n?/, install ? '$1' : '')
    .replace('{{name}}', () => name)
    .replace('{{goal}}', () => req.goal.trim())
    .replace('{{features}}', () => req.brs.filter((b) => b.priority !== 'could').map((b) => `- ${b.title}`).join('\n'))
    .replace('{{flow}}', () => mermaid(arch.flow))
    .replace('{{install}}', () => install)
    .replace('{{usage}}', () => usageSection(arch));
}

export function applyReadme(existing: string | undefined, section: string): string {
  if (!existing?.trim()) return section;
  const a = existing.indexOf(START);
  const b = existing.indexOf(END);
  if (a >= 0 && b > a) return existing.slice(0, a) + section.trim() + existing.slice(b + END.length);
  return existing.trimEnd() + '\n\n' + section;
}

export function writeReadme(dir: string, name: string, req: Requirement, arch: Architecture): string {
  const found = fs.readdirSync(dir).find((f) => f.toLowerCase() === 'readme.md');
  const file = path.join(dir, found ?? 'readme.md');
  const existing = found ? fs.readFileSync(file, 'utf8') : undefined;
  fs.writeFileSync(file, applyReadme(existing, renderReadme(name, req, arch)));
  return file;
}
