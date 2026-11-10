// Live updates for one run. The browser reconnects by itself; the server resends the state on every connection.
import type { RunView } from '../../src/server/model.ts';
import type { EventRow } from './api.ts';

export interface LiveHandlers {
  run: (view: RunView) => void;
  event: (row: EventRow) => void;
  status: (text: string) => void;
}

export function openRun(id: string, after: number, handlers: LiveHandlers): () => void {
  const source = new EventSource(`/api/runs/${id}/stream?after=${after}`);
  source.addEventListener('run', (e) => handlers.run(JSON.parse((e as MessageEvent<string>).data) as RunView));
  source.addEventListener('event', (e) => handlers.event(JSON.parse((e as MessageEvent<string>).data) as EventRow));
  source.addEventListener('error', (e) => {
    const data = (e as MessageEvent<string>).data;
    if (data) {
      handlers.status(JSON.parse(data).error as string);
      return;
    }
    if (source.readyState === EventSource.CONNECTING) handlers.status('Live updates paused. Reconnecting.');
  });
  source.onopen = () => handlers.status('');
  return () => source.close();
}
