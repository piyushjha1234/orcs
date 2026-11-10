// A small History API router. Links with data-link or same-site hrefs navigate in the page.
import { reducedMotion } from './a11y.ts';

type Handler = (params: string[]) => void | Promise<void>;

interface Route {
  pattern: RegExp;
  handler: Handler;
}

const routes: Route[] = [];
let notFound: Handler = () => undefined;
let beforeEach: () => void = () => undefined;

export function route(pattern: RegExp, handler: Handler): void {
  routes.push({ pattern, handler });
}

export function onNotFound(handler: Handler): void {
  notFound = handler;
}

export function onLeave(fn: () => void): void {
  beforeEach = fn;
}

async function render(): Promise<void> {
  const path = location.pathname;
  beforeEach();
  for (const r of routes) {
    const m = r.pattern.exec(path);
    if (!m) continue;
    const run = () => r.handler(m.slice(1));
    const supportsTransitions = 'startViewTransition' in document;
    if (supportsTransitions && !reducedMotion()) await document.startViewTransition(run).finished;
    else await run();
    return;
  }
  await notFound([]);
}

export async function navigate(url: string, replace = false): Promise<void> {
  if (url === location.pathname + location.search) return;
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  await render();
}

export function start(): void {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[href]');
    if (!a || a.target || a.hasAttribute('download')) return;
    const url = new URL(a.href);
    if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
    e.preventDefault();
    void navigate(url.pathname + url.search);
  });
  window.addEventListener('popstate', () => void render());
  void render();
}
