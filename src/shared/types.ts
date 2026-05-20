// Core domain types and the typed IPC contract. This file is the single
// source of truth that main and renderer mirror — see docs/architecture.md.

export type SessionStatus = 'idle' | 'working' | 'awaiting-input';

export interface Session {
  id: string;
  name: string;
  worktreePath: string;
  baseBranch: string;
  createdAt: number;
  lastActivityAt: number;
  status: SessionStatus;
  ptyAlive: boolean;
  initialPrompt?: string;
}

export interface RepoInfo {
  path: string;
  name: string;
  defaultBranch: string;
}

export interface Settings {
  claudeBinaryPath?: string;
  autoResumeConversations: boolean;
  notifyOnAwaitingInput: boolean;
}

export interface ClaudeStatus {
  ready: boolean;
  version?: string;
  error?: string;
}

export interface PersistedState {
  schemaVersion: 1;
  repoPath: string | null;
  sessions: Session[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  claudeBinaryPath: '',
  autoResumeConversations: true,
  notifyOnAwaitingInput: false,
};

// IPC contract. The renderer and main mirror this shape — adding an intent
// means updating this map, then implementing it on both sides.

export interface IpcIntents {
  'repo:select': { request: { path: string }; response: RepoInfo };
  'repo:current': { request: void; response: RepoInfo | null };
  'session:create': {
    request: { name: string; baseBranch: string; initialPrompt?: string };
    response: Session;
  };
  'session:list': { request: void; response: Session[] };
  'session:sendInput': { request: { id: string; text: string }; response: void };
  'session:resume': { request: { id: string }; response: Session };
  'session:forget': { request: { id: string }; response: void };
  'session:replayBuffer': { request: { id: string }; response: string };
  'settings:get': { request: void; response: Settings };
  'settings:update': { request: Partial<Settings>; response: Settings };
  'claude:status': { request: void; response: ClaudeStatus };
  'dialog:pickFolder': { request: void; response: string | null };
}

export type IpcChannel = keyof IpcIntents;
export type IpcRequest<C extends IpcChannel> = IpcIntents[C]['request'];
export type IpcResponse<C extends IpcChannel> = IpcIntents[C]['response'];

export interface IpcEvents {
  'session:output': { id: string; chunk: string };
  'session:status-changed': { id: string; status: SessionStatus };
  'session:exit': { id: string; code: number };
  'session:added': { session: Session };
  'session:updated': { session: Session };
  'claude:status-changed': ClaudeStatus;
}

export type IpcEventChannel = keyof IpcEvents;
export type IpcEventPayload<C extends IpcEventChannel> = IpcEvents[C];
