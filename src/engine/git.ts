import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';

const ID = ['-c', 'user.name=orcs', '-c', 'user.email=orcs@localhost'];

const children = new Set<ChildProcess>();

export function track(p: ChildProcess): void {
  children.add(p);
  p.on('close', () => children.delete(p));
}

export function killChildren(): void {
  for (const p of children) {
    try {
      if (p.pid) process.kill(-p.pid, 'SIGTERM');
    } catch {
      p.kill('SIGTERM');
    }
  }
}

export interface ShResult {
  code: number;
  out: string;
}

export function sh(command: string, cwd: string): Promise<ShResult> {
  return new Promise((resolve) => {
    const p = spawn('sh', ['-c', command], { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    track(p);
    let out = '';
    const add = (d: Buffer) => {
      out = (out + d.toString()).slice(-200_000);
    };
    p.stdout.on('data', add);
    p.stderr.on('data', add);
    p.on('error', (e) => resolve({ code: 127, out: String(e) }));
    p.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

export function excerpt(out: string, lines = 60): string {
  return out.trimEnd().split('\n').slice(-lines).join('\n');
}

export function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function tryGit(args: string[], cwd: string): { ok: boolean; out: string } {
  try {
    return { ok: true, out: git(args, cwd) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() || err.message };
  }
}

function ownRepo(dir: string): boolean {
  const top = tryGit(['rev-parse', '--show-toplevel'], dir);
  return top.ok && fs.realpathSync(top.out) === fs.realpathSync(dir);
}

export function ensureRepo(dir: string): { branch: string; base: string } {
  fs.mkdirSync(dir, { recursive: true });
  if (!ownRepo(dir)) git(['init', '-q', '-b', 'main'], dir);
  if (!tryGit(['rev-parse', '--verify', 'HEAD'], dir).ok) git([...ID, 'commit', '-q', '--allow-empty', '-m', 'orcs: start'], dir);
  return { branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], dir), base: git(['rev-parse', 'HEAD'], dir) };
}

export function excludeLocal(project: string, patterns: string[]): void {
  const common = path.resolve(project, git(['rev-parse', '--git-common-dir'], project));
  const file = path.join(common, 'info', 'exclude');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : [];
  const add = patterns.filter((p) => p && !have.includes(p));
  if (add.length) fs.appendFileSync(file, (have.length && have.at(-1) !== '' ? '\n' : '') + add.join('\n') + '\n');
}

export function addWorktree(project: string, dir: string, branch: string, from: string): void {
  if (fs.existsSync(path.join(dir, '.git'))) return;
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  git(['worktree', 'add', '-q', '-B', branch, dir, from], project);
}

export function removeWorktree(project: string, dir: string): void {
  tryGit(['worktree', 'remove', '--force', dir], project);
}

export function head(cwd: string): string {
  return git(['rev-parse', 'HEAD'], cwd);
}

export function commitAll(cwd: string, message: string): boolean {
  git(['add', '-A'], cwd);
  if (tryGit(['diff', '--cached', '--quiet'], cwd).ok) return false;
  git([...ID, 'commit', '-q', '-m', message], cwd);
  return true;
}

export function changedFiles(cwd: string, base: string): string[] {
  const out = git(['diff', '--name-only', base, 'HEAD'], cwd);
  return out ? out.split('\n') : [];
}

export function merge(cwd: string, branch: string, message: string): { ok: boolean; out: string } {
  const r = tryGit([...ID, 'merge', '-q', '--no-ff', '-m', message, branch], cwd);
  if (!r.ok) tryGit(['merge', '--abort'], cwd);
  return r;
}

export function revertPaths(cwd: string, base: string, files: string[]): void {
  for (const f of files) {
    if (tryGit(['cat-file', '-e', `${base}:${f}`], cwd).ok) git(['checkout', '-q', base, '--', f], cwd);
    else tryGit(['rm', '-q', '-f', '--', f], cwd);
  }
  commitAll(cwd, 'orcs: revert files outside the task');
}

export function isAncestor(cwd: string, rev: string, of: string): boolean {
  return tryGit(['merge-base', '--is-ancestor', rev, of], cwd).ok;
}

export function currentBranch(cwd: string): string {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
}

export function resetHard(cwd: string, rev: string): void {
  git(['reset', '-q', '--hard', rev], cwd);
}

export function reviewClone(project: string, dir: string, branch: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  git(['clone', '-q', project, dir], path.dirname(dir));
  git(['checkout', '-q', '-B', 'review', `origin/${branch}`], dir);
}
