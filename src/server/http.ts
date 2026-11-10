// The HTTP server behind `orcs ui`. Serves the web app from web/ and the JSON API from api.ts.
// Browser code is TypeScript. It is stripped to JavaScript on request, so there is no build step.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import module from 'node:module';
import zlib from 'node:zlib';
import { api, json, HttpError } from './api.ts';
import { COOKIE, cookieValue, hostAllowed, makeGuard, sameToken, type Guard } from './auth.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const WEB = path.join(ROOT, 'web');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

type Asset = { mtime: number; body: Buffer; gzip?: Buffer; etag: string };
const cache = new Map<string, Asset>();

function assetFile(pathname: string): string | undefined {
  if (pathname === '/src/view.ts') return path.join(ROOT, 'src', 'view.ts');
  if (!pathname.startsWith('/web/')) return undefined;
  const file = path.normalize(path.join(WEB, pathname.slice('/web/'.length)));
  return file.startsWith(WEB + path.sep) ? file : undefined;
}

function loadAsset(file: string): Asset | undefined {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return undefined;
  const mtime = fs.statSync(file).mtimeMs;
  const hit = cache.get(file);
  if (hit && hit.mtime === mtime) return hit;
  let body = fs.readFileSync(file);
  if (file.endsWith('.ts')) body = Buffer.from(module.stripTypeScriptTypes(body.toString('utf8')));
  // woff2 is already compressed.
  const gzip = file.endsWith('.woff2') ? undefined : zlib.gzipSync(body, { level: 9 });
  const entry = { mtime, body, gzip, etag: `"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 16)}"` };
  cache.set(file, entry);
  return entry;
}

function sendAsset(req: http.IncomingMessage, res: http.ServerResponse, file: string): void {
  const asset = loadAsset(file);
  if (!asset) return text(res, 404, 'Not found.');
  const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
  if (req.headers['if-none-match'] === asset.etag) {
    res.writeHead(304, { ...SECURITY, ETag: asset.etag, 'Cache-Control': 'no-cache' });
    res.end();
    return;
  }
  const gzip = asset.gzip && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')) ? asset.gzip : undefined;
  res.writeHead(200, {
    ...SECURITY,
    'Content-Type': type,
    ETag: asset.etag,
    'Cache-Control': 'no-cache',
    Vary: 'Accept-Encoding',
    ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : (gzip ?? asset.body));
}

function text(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { ...SECURITY, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

const NOT_LINKED = 'Open the link that orcs ui printed in your terminal.';

function loopbackHost(header: string | undefined): boolean {
  if (!header) return false;
  const name = header.startsWith('[') ? header.slice(0, header.indexOf(']') + 1) : header.split(':')[0];
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]' || name === '::1';
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, guard: Guard): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  for (const [k, v] of Object.entries(SECURITY)) res.setHeader(k, v);

  if (!hostAllowed(req.headers.host, guard)) return text(res, 403, 'Unknown host name. Use the address orcs ui printed.');

  // The first visit carries the token in the URL. It is swapped for a cookie and removed from the address bar.
  if (url.searchParams.has('token')) {
    if (!sameToken(url.searchParams.get('token'), guard.token)) return text(res, 403, 'This link is not valid. ' + NOT_LINKED);
    url.searchParams.delete('token');
    res.writeHead(302, {
      Location: `${url.pathname}${url.search}`,
      'Set-Cookie': `${COOKIE}=${guard.token}; HttpOnly; SameSite=Strict; Path=/`,
      'Cache-Control': 'no-store',
    });
    res.end();
    return;
  }

  // This computer can open the site directly. A phone or another machine still needs the token.
  const here = hostAllowed(req.headers.host, guard) && loopbackHost(req.headers.host);
  if (!here && !sameToken(cookieValue(req, COOKIE), guard.token)) {
    if (url.pathname.startsWith('/api/')) return json(res, 401, { error: NOT_LINKED });
    return text(res, 401, NOT_LINKED);
  }

  if (!['GET', 'HEAD'].includes(req.method ?? 'GET')) {
    if (req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Blocked: this request came from another site.' });
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: 'Send JSON.' });
  }

  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const file = assetFile(url.pathname);
    if (file) return sendAsset(req, res, file);
    // Any other path is an app route, so the app itself decides what to show.
    if (path.extname(url.pathname) === '') return sendAsset(req, res, path.join(WEB, 'index.html'));
    return text(res, 404, 'Not found.');
  } catch (e) {
    if (e instanceof HttpError) return json(res, e.status, { error: e.message, field: e.field });
    return json(res, 500, { error: (e as Error).message || 'Something went wrong. Check the terminal.' });
  }
}

export interface Server {
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

export function serve(opts: { host?: string; port?: number }): Promise<Server> {
  const host = opts.host ?? '127.0.0.1';
  const guard = makeGuard(host);
  const server = http.createServer((req, res) => {
    handle(req, res, guard).catch((e: Error) => {
      if (!res.headersSent) json(res, 500, { error: e.message });
      else res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 4477, host, () => {
      const { port } = server.address() as AddressInfo;
      const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
      resolve({
        url: `http://${shown}:${port}/?token=${guard.token}`,
        port,
        token: guard.token,
        close: () => new Promise<void>((done) => {
          server.closeAllConnections();
          server.close(() => done());
        }),
      });
    });
  });
}
