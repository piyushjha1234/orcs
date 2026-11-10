// Live updates for one run over server-sent events.
// A write to the run folder triggers a short debounce, then the current run state and any new events are sent.
// A slow tick also runs, so a process that dies without writing its state is still noticed.
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OrcsEvent } from '../types.ts';
import * as store from '../engine/store.ts';
import { runView } from './model.ts';

const DEBOUNCE_MS = 150;
const TICK_MS = 2000;
const PING_MS = 15_000;

export function streamRun(_req: IncomingMessage, res: ServerResponse, id: string, after: number): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');

  let seen = Math.max(0, after);
  let last = '';
  let closed = false;

  const send = (event: string, data: unknown, seq?: number) => {
    if (!closed) res.write(`${seq !== undefined ? `id: ${seq}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const push = () => {
    if (closed) return;
    try {
      const run = runView(id);
      const body = JSON.stringify(run);
      if (body !== last) {
        last = body;
        send('run', run);
      }
      const events = store.readLines<OrcsEvent>(store.runFile(id, 'events.jsonl'));
      for (; seen < events.length; seen++) send('event', { seq: seen, ...events[seen] }, seen);
    } catch (e) {
      send('error', { error: (e as Error).message });
    }
  };

  let timer: NodeJS.Timeout | undefined;
  const debounced = () => {
    clearTimeout(timer);
    timer = setTimeout(push, DEBOUNCE_MS);
  };
  // A watcher can fail (for example when the OS limits watches). The tick below then delivers updates alone.
  let watcher: fs.FSWatcher | undefined;
  try {
    watcher = fs.watch(store.runDir(id), debounced);
    watcher.on('error', () => {
      watcher?.close();
      watcher = undefined;
    });
  } catch {
    watcher = undefined;
  }
  const tick = setInterval(push, TICK_MS);
  const ping = setInterval(() => {
    if (!closed) res.write(': ping\n\n');
  }, PING_MS);

  // The response closes when the browser goes away. The request closes as soon as it is read, so it is not used here.
  res.on('close', () => {
    closed = true;
    clearTimeout(timer);
    clearInterval(tick);
    clearInterval(ping);
    watcher?.close();
  });

  push();
}
