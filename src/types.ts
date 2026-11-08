// On-disk formats shared by the engine, the CLI and any future UI.

export type Role = 'analyst' | 'architect' | 'developer' | 'tester';
export type Agent = Role | 'security';
export type Intensity = 'low' | 'medium' | 'high';
export type Mode = 'safe' | 'project' | 'global';
export type Risk = 'high' | 'medium' | 'low';

export type Stage =
  | 'analyst' | 'skills' | 'architect' | 'build'
  | 'test' | 'bugs' | 'fix' | 'accept' | 'rating' | 'finish' | 'done';

export type RunStatus = 'running' | 'waiting' | 'stopped' | 'failed' | 'done';

export type TaskStatus = 'waiting' | 'building' | 'checking' | 'fixing' | 'blocked' | 'merged' | 'failed';

export interface Intake {
  name: string;
  dir: string;
  requirements: string;
  skills: string[];
  global_skills: boolean;
}

export interface Question {
  id: string;
  from: string;
  text: string;
  options: string[];
  recommended: number;
  details?: string[];
  free_text?: boolean;
  agent_qid?: string;
  created_at: string;
}

export interface Answer {
  id: string;
  choice?: number;
  text?: string;
  at: string;
  by: string;
}

export interface OrcsEvent {
  at: string;
  kind: string;
  text: string;
  task?: string;
  gate?: string;
}

export interface Decision {
  q: string;
  choice?: number;
  text?: string;
}

export interface Convo {
  session: string;
  started: boolean;
  model: string;
  pending: string[];
  next_prompt: string;
  done: boolean;
  last_errors?: string;
  repeats: number;
}

export interface TaskState {
  id: string;
  title: string;
  kind: 'build' | 'fix' | 'plan';
  status: TaskStatus;
  model: string;
  fails: number;
  base?: string;
  last_check?: string;
  note?: string;
  started_at?: string;
  ended_at?: string;
}

export interface Approval {
  file: string;
  sha256: string;
  at: string;
}

export interface Counters {
  rework: number;
  scope_violations: number;
  blockers: number;
  contract_retries: number;
}

export interface State {
  id: string;
  name: string;
  project: string;
  branch: string;
  base: string;
  created_at: string;
  updated_at: string;
  ended_at?: string;
  stage: Stage;
  status: RunStatus;
  pid?: number;
  error?: string;
  intake: Intake;
  installed: string[];
  skills: string[];
  security_review: boolean;
  decisions: Record<string, Decision>;
  fix: string[];
  test: boolean | null;
  intensity: Intensity | null;
  round: number;
  rating?: number;
  convos: Record<string, Convo>;
  tasks: Record<string, TaskState>;
  approvals: Record<string, Approval>;
  counters: Counters;
}

export interface AgentQuestion {
  id: string;
  text: string;
  options: string[];
  recommended: number;
}

export interface Br {
  id: string;
  title: string;
  text: string;
  priority: 'must' | 'should' | 'could';
  ac: string[];
}

export interface Targets {
  platforms: string[];
  devices: string[];
  browsers: string[];
  expected_users: number;
  logins: boolean;
  personal_data: boolean;
  payments: boolean;
  public_api: boolean;
}

export interface Requirement {
  goal: string;
  users: string[];
  non_goals: string[];
  brs: Br[];
  targets: Targets;
  constraints: string[];
  assumptions: string[];
}

export interface Task {
  id: string;
  title: string;
  brs: string[];
  files: string[];
  deps: string[];
  steps: string[];
  interfaces: string[];
  facts: string[];
  ac: string[];
  test: string;
  skills: string[];
}

export interface Env {
  id: string;
  browser: string;
  device: string;
  primary: boolean;
}

export interface Setup {
  runtime: string;
  install: string;
  env: { name: string; example: string }[];
  commands: { build: string; test: string; start: string; acceptance: string };
  url: string;
  tests_dir: string;
  ignore: string[];
}

export interface Architecture {
  stack: { layer: string; choice: string; version: string; why: string }[];
  setup: Setup;
  interfaces: { id: string; kind: string; name: string; spec: string }[];
  developers: number;
  tasks: Task[];
  test_scope: { types: string[]; matrix: Env[]; load_users: number; tools: string[] };
  flow: { steps: { id: string; label: string }[]; links: { from: string; to: string; label: string }[] };
  usage: string[];
}

export interface TestCase {
  id: string;
  br: string;
  type: string;
  envs: string[];
  title: string;
  steps: string[];
  expected: string;
  auto: boolean;
}

export interface TestPlan {
  cases: TestCase[];
  files: string[];
}

export interface Bug {
  id: string;
  risk: Risk;
  type: string;
  br: string;
  env: string;
  file: string;
  title: string;
  steps: string[];
  expected: string;
  actual: string;
  evidence: string;
  status: 'open' | 'fixed';
}

export interface BugReport {
  round: number;
  results: { case: string; status: 'pass' | 'fail' | 'skipped' }[];
  bugs: Bug[];
}

export interface Usage {
  at: string;
  run: string;
  agent: Agent;
  task?: string;
  model: string;
  session: string;
  turns: number;
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
  effective: number;
  cost: number;
  cost_basis: string;
  duration_ms: number;
  outcome: string;
}
