import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Requirement } from '../types.ts';
import { excludeLocal, sh } from './git.ts';
import { frontmatter, readJson } from './store.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

export interface Recommended {
  name: string;
  kind: 'install' | 'builtin';
  source?: string;
  skill?: string;
  what: string;
  when: 'ui' | 'sensitive';
}

export interface SkillInfo {
  name: string;
  description: string;
}

const UI_PLATFORMS = ['web', 'ios', 'android', 'desktop'];

export function recommendations(req: Requirement): Recommended[] {
  const t = req.targets;
  const ui = t.platforms.some((p) => UI_PLATFORMS.includes(p));
  const sensitive = t.logins || t.personal_data || t.payments || t.public_api;
  const all = readJson<{ recommended: Recommended[] }>(path.join(ROOT, 'config', 'skills.json')).recommended;
  return all.filter((r) => (r.when === 'ui' && ui) || (r.when === 'sensitive' && sensitive));
}

export function parseSkillList(input: string): string[] {
  return input.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

// One answer covers both. The word "global" turns on global skills. Anything else is a skill name or source.
export function parseSkillAnswer(input: string): { items: string[]; global: boolean } {
  const tokens = parseSkillList(input);
  return {
    items: tokens.filter((t) => !/^global$/i.test(t)),
    global: tokens.some((t) => /^global$/i.test(t)),
  };
}

export function isSource(s: string): boolean {
  return /^https?:\/\//.test(s) || /^[\w.-]+\/[\w.-]+(@[\w.:-]+)?$/.test(s);
}

function skillDirs(dir: string): SkillInfo[] {
  if (!fs.existsSync(dir)) return [];
  const out: SkillInfo[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const { data } = frontmatter(fs.readFileSync(file, 'utf8'));
    out.push({ name: data.name || name, description: (data.description || '').slice(0, 200) });
  }
  return out;
}

export function projectSkills(project: string): SkillInfo[] {
  return skillDirs(path.join(project, '.claude', 'skills'));
}

export function globalSkillNames(): string[] {
  return skillDirs(path.join(os.homedir(), '.claude', 'skills')).map((s) => s.name);
}

export async function findSkills(query: string, cwd: string): Promise<string[]> {
  const r = await sh(`npx -y skills find ${JSON.stringify(query)} < /dev/null`, cwd);
  const found: string[] = [];
  for (const line of r.out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').split('\n')) {
    const m = /^([\w.-]+\/[\w.-]+@[\w.:-]+)\s+([\d.]+[KM]?) installs/.exec(line.trim());
    if (m) found.push(`${m[1]} (${m[2]} installs)`);
  }
  return found.slice(0, 3);
}

export async function installSkill(project: string, source: string): Promise<string[]> {
  const [repo, skill] = /^https?:\/\//.test(source) ? [source, ''] : source.split('@');
  const pick = skill ? `--skill ${JSON.stringify(skill)}` : `--skill '*'`;
  const r = await sh(`npx -y skills add ${JSON.stringify(repo)} ${pick} -a claude-code -y --copy --json < /dev/null`, project);
  const json = r.out.slice(r.out.indexOf('['), r.out.lastIndexOf(']') + 1);
  let rows: { name: string; status: string }[] = [];
  try {
    rows = JSON.parse(json);
  } catch {
    // reported below
  }
  const installed = rows.filter((x) => x.status === 'installed').map((x) => x.name);
  if (r.code !== 0 || !installed.length) throw new Error(`Could not install ${source}.`);
  excludeLocal(project, ['.claude/skills', 'skills-lock.json']);
  return installed;
}

export function linkSkills(project: string, worktree: string): void {
  const target = path.join(project, '.claude', 'skills');
  const link = path.join(worktree, '.claude', 'skills');
  if (!fs.existsSync(target) || fs.existsSync(link)) return;
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, 'dir');
}
