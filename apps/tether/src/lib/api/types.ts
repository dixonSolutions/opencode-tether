export type RemoteKind = 'remote' | 'local';

export interface Remote {
  id: string;
  name: string;
  url: string;
  username?: string;
  password?: string;
  token?: string;
  kind: RemoteKind;
  createdAt: number;
  lastUsedAt?: number;
  favorite?: boolean;
}

export interface HostInfo {
  name: string;
  version: string;
  mode: 'host';
  requiresAuth: boolean;
  upstream: { healthy: boolean; version?: string; error?: string };
  features?: Record<string, boolean>;
}

export type HealthState = 'unknown' | 'checking' | 'online' | 'idle' | 'offline' | 'unauthorized';

export interface RemoteHealth {
  state: HealthState;
  latencyMs?: number;
  version?: string;
  busySessions?: number;
  checkedAt?: number;
  error?: string;
}

export interface Session {
  id: string;
  slug?: string;
  projectID?: string;
  workspaceID?: string;
  directory?: string;
  path?: string;
  parentID?: string;
  title?: string;
  version?: string;
  agent?: string;
  model?: { id: string; providerID: string; variant?: string };
  cost?: number;
  tokens?: TokenUsage;
  summary?: { additions: number; deletions: number; files: number; diffs?: SnapshotFileDiff[] };
  share?: { url: string };
  permission?: unknown;
  time: { created: number; updated: number; archived?: number };
}

export interface TokenUsage {
  total?: number;
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export type MessageRole = 'user' | 'assistant';

export interface MessageInfo {
  id: string;
  sessionID: string;
  role: MessageRole;
  time: { created: number; completed?: number };
  parentID?: string;
  modelID?: string;
  providerID?: string;
  mode?: string;
  agent?: string;
  model?: { providerID: string; modelID: string; variant?: string };
  cost?: number;
  tokens?: TokenUsage;
  finish?: string;
  error?: MessageError;
  summary?: boolean | { title?: string; body?: string };
  path?: { cwd: string; root: string };
  system?: string;
}

export interface MessageError {
  name?: string;
  message?: string;
  data?: { message?: string; [key: string]: unknown };
}

export interface MessageWithParts {
  info: MessageInfo;
  parts: Part[];
}

export interface PartBase {
  id: string;
  sessionID: string;
  messageID: string;
  type: string;
}

export interface TextPart extends PartBase {
  type: 'text';
  text: string;
  synthetic?: boolean;
  ignored?: boolean;
  time?: { start?: number; end?: number };
}

export interface ReasoningPart extends PartBase {
  type: 'reasoning';
  text: string;
  time?: { start: number; end?: number };
}

export interface FilePart extends PartBase {
  type: 'file';
  mime: string;
  filename?: string;
  url: string;
  source?: unknown;
}

export interface AgentPart extends PartBase {
  type: 'agent';
  name: string;
  source?: unknown;
}

export interface SubtaskPart extends PartBase {
  type: 'subtask';
  prompt: string;
  description: string;
  agent: string;
  model?: { providerID: string; modelID: string };
}

export interface StepStartPart extends PartBase {
  type: 'step-start';
  snapshot?: string;
}

export interface StepFinishPart extends PartBase {
  type: 'step-finish';
  reason?: string;
  cost?: number;
  tokens?: TokenUsage;
  snapshot?: string;
}

export interface PatchPart extends PartBase {
  type: 'patch';
  hash: string;
  files: string[];
}

export interface SnapshotPart extends PartBase {
  type: 'snapshot';
  snapshot: string;
}

export interface RetryPart extends PartBase {
  type: 'retry';
  attempt: number;
  error?: MessageError;
  time: { created: number };
}

export interface CompactionPart extends PartBase {
  type: 'compaction';
  auto?: boolean;
  overflow?: boolean;
}

export interface ToolPart extends PartBase {
  type: 'tool';
  callID: string;
  tool: string;
  state: ToolState;
  metadata?: Record<string, unknown>;
}

export type ToolState =
  | { status: 'pending'; input?: Record<string, unknown>; raw?: string; time?: { start?: number } }
  | { status: 'running'; input: Record<string, unknown>; title?: string; metadata?: Record<string, unknown>; time: { start: number } }
  | {
      status: 'completed';
      input: Record<string, unknown>;
      output: string;
      title: string;
      metadata: Record<string, unknown>;
      time: { start: number; end: number; compacted?: number };
      attachments?: FilePart[];
    }
  | { status: 'error'; input: Record<string, unknown>; error: string; metadata?: Record<string, unknown>; time: { start: number; end: number } };

export type Part =
  | TextPart
  | ReasoningPart
  | FilePart
  | AgentPart
  | SubtaskPart
  | StepStartPart
  | StepFinishPart
  | PatchPart
  | SnapshotPart
  | RetryPart
  | CompactionPart
  | ToolPart;

export interface DiffFile {
  file: string;
  status?: string;
  additions: number;
  deletions: number;
  patch?: string;
  before?: string;
  after?: string;
}

export interface SnapshotFileDiff {
  file: string;
  status?: string;
  additions: number;
  deletions: number;
  patch?: string;
  before?: string;
  after?: string;
}

export type SessionStatus =
  | { type: 'idle' }
  | { type: 'busy' }
  | { type: 'retry'; attempt: number; message: string; next: number; action?: { title: string; provider: string; message: string; label: string; link?: string } };

export interface Todo {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | string;
  priority: 'high' | 'medium' | 'low' | string;
}

export interface PermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
  always: string[];
  tool?: { messageID: string; callID: string };
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionInfo {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export interface QuestionRequest {
  id: string;
  sessionID: string;
  questions: QuestionInfo[];
  tool?: unknown;
}

export interface Agent {
  name: string;
  description?: string;
  mode: 'primary' | 'subagent' | 'all';
  native?: boolean;
  hidden?: boolean;
  color?: string;
  model?: { providerID: string; modelID: string };
  variant?: string;
  prompt?: string;
  options?: Record<string, unknown>;
  permission?: unknown;
  steps?: number;
}

export interface Model {
  id: string;
  providerID: string;
  name: string;
  family?: string;
  capabilities?: {
    temperature?: boolean;
    reasoning?: boolean;
    attachment?: boolean;
    toolcall?: boolean;
    input?: Record<string, boolean>;
    output?: Record<string, boolean>;
  };
  cost?: { input: number; output: number; [key: string]: unknown };
  limit?: { context: number; output: number };
  status?: string;
}

export interface Provider {
  id: string;
  name: string;
  source: string;
  env: string[];
  options: Record<string, unknown>;
  models: Record<string, Model>;
}

export interface ProvidersResponse {
  all: Provider[];
  default: Record<string, string>;
  connected: string[];
}

export interface Command {
  name: string;
  description?: string;
  agent?: string;
  model?: string;
  source: 'command' | 'mcp' | 'skill' | string;
  template: string;
  subtask?: boolean;
  hints?: string[];
}

export interface Project {
  id: string;
  worktree: string;
  vcs?: string;
  time?: { created: number; updated: number };
  sandboxes?: string[];
}

export interface FileNode {
  name: string;
  path: string;
  absolute?: string;
  type: 'file' | 'directory';
  ignored?: boolean;
  children?: FileNode[];
}

export interface FileContent {
  type?: 'text' | 'binary';
  content: string;
  diff?: string;
  patch?: string;
  encoding?: string;
  mimeType?: string;
}

export interface Config {
  model?: string;
  username?: string;
  theme?: string;
  [key: string]: unknown;
}

export interface TetherEvent {
  id?: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface PromptBody {
  messageID?: string;
  model?: { providerID: string; modelID: string };
  agent?: string;
  variant?: string;
  noReply?: boolean;
  system?: string;
  tools?: Record<string, boolean>;
  parts: Array<
    | { type: 'text'; text: string }
    | { type: 'file'; mime: string; filename?: string; url: string }
    | { type: 'agent'; name: string }
    | { type: 'subtask'; prompt: string; description: string; agent: string }
  >;
}

export interface PermissionReply {
  reply: 'once' | 'always' | 'reject';
  message?: string;
}

export interface QuestionReply {
  answers: string[][];
}

export interface ApiErrorBody {
  name?: string;
  data?: { message?: string; [key: string]: unknown };
}
