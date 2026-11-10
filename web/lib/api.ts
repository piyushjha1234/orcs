// Calls to the orcs ui JSON API. Errors carry the plain message from the server and the field it belongs to.
import type { OrcsEvent, Architecture, BugReport, Requirement, Role } from '../../src/types.ts';
import type { ReportData } from '../../src/engine/report.ts';
import type { RunSummary, RunView } from '../../src/server/model.ts';

export class ApiError extends Error {
  status: number;
  field?: string;
  constructor(message: string, status: number, field?: string) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

export type EventRow = OrcsEvent & { seq: number };

export interface Settings {
  models: string[];
  agents: { role: Role; model: string; default: string }[];
}

export interface RunDetail extends RunView {
  events: { total: number; recent: EventRow[] };
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError('Cannot reach orcs ui. Check that it is still running in the terminal.', 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; field?: string };
  if (res.status === 401) throw new ApiError('Open the link orcs ui printed in your terminal.', 401);
  if (!res.ok) throw new ApiError(data.error ?? `The request failed (${res.status}).`, res.status, data.field);
  return data as T;
}

export const api = {
  runs: () => call<{ runs: RunSummary[] }>('GET', '/api/runs'),
  run: (id: string) => call<RunDetail>('GET', `/api/runs/${id}`),
  requirement: (id: string) => call<Requirement | null>('GET', `/api/runs/${id}/requirement`),
  architecture: (id: string) => call<Architecture | null>('GET', `/api/runs/${id}/architecture`),
  bugs: (id: string) => call<BugReport | null>('GET', `/api/runs/${id}/bugs`),
  report: (id: string) => call<ReportData>('GET', `/api/runs/${id}/report`),
  answer: (id: string, question: string, answer: string) => call<{ answered: string }>('POST', `/api/runs/${id}/answers`, { question, answer }),
  stop: (id: string) => call<{ stopping: string }>('POST', `/api/runs/${id}/stop`, {}),
  deleteRun: (id: string) => call<Record<string, never>>('DELETE', `/api/runs/${id}`, {}),
  resume: (id: string) => call<{ started: string }>('POST', `/api/runs/${id}/resume`, {}),
  createRun: (body: { name: string; requirements: string; skills: string; global_skills: boolean; dir: string }) =>
    call<{ id: string }>('POST', '/api/runs', body),
  folder: (name: string, dir = '') => call<{ dir: string }>('GET', `/api/folder?name=${encodeURIComponent(name)}&dir=${encodeURIComponent(dir)}`),
  dirs: (dir = '') => call<{ path: string; parent: string | null; dirs: string[] }>('GET', `/api/dirs?path=${encodeURIComponent(dir)}`),
  pickFolder: (dir = '') => call<{ path: string | null }>('POST', '/api/pick-folder', { path: dir }),
  skills: (q: string) => call<{ skills: { source: string; installs: string }[] }>('GET', `/api/skills?q=${encodeURIComponent(q)}`),
  settings: () => call<Settings>('GET', '/api/settings'),
  saveModels: (agents: Partial<Record<Role, string>>) => call<Settings>('PUT', '/api/settings', { agents }),
};
