// Who may use the web UI: a random token from the terminal, a cookie that carries it,
// and checks that stop other sites and DNS tricks from reaching the API.
import crypto from 'node:crypto';
import os from 'node:os';
import type { IncomingMessage } from 'node:http';

export const COOKIE = 'orcs_session';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export interface Guard {
  token: string;
  hosts: Set<string>;
}

export function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((a) => a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

export function makeGuard(bind: string): Guard {
  const hosts = new Set(LOOPBACK);
  if (bind === '0.0.0.0' || bind === '::') for (const a of lanAddresses()) hosts.add(a);
  else if (!LOOPBACK.has(bind)) hosts.add(bind);
  return { token: crypto.randomBytes(24).toString('base64url'), hosts };
}

// Host header names are checked without the port, so DNS rebinding from another name is refused.
export function hostAllowed(header: string | undefined, guard: Guard): boolean {
  if (!header) return false;
  const name = header.startsWith('[') ? header.slice(0, header.indexOf(']') + 1) : header.split(':')[0];
  return guard.hosts.has(name);
}

export function sameToken(given: string | undefined | null, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function cookieValue(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}
