import { describe, expectTypeOf, it } from 'vitest';
import type {
  IpcEventPayload,
  IpcRequest,
  IpcResponse,
  RepoInfo,
  Session,
  Settings,
} from '../src/shared/types.js';
import { DEFAULT_SETTINGS } from '../src/shared/types.js';

// These are intentionally type-level assertions; if the IPC contract drifts
// from its consumers, the build fails here rather than at runtime.
describe('IPC contract', () => {
  it('repo:select request/response shapes are stable', () => {
    expectTypeOf<IpcRequest<'repo:select'>>().toEqualTypeOf<{ path: string }>();
    expectTypeOf<IpcResponse<'repo:select'>>().toEqualTypeOf<RepoInfo>();
  });

  it('settings:update accepts partial Settings', () => {
    expectTypeOf<IpcRequest<'settings:update'>>().toEqualTypeOf<Partial<Settings>>();
    expectTypeOf<IpcResponse<'settings:update'>>().toEqualTypeOf<Settings>();
  });

  it('default settings match the documented schema', () => {
    expectTypeOf(DEFAULT_SETTINGS).toMatchTypeOf<Settings>();
  });

  it('repo:current can return null', () => {
    expectTypeOf<IpcResponse<'repo:current'>>().toEqualTypeOf<RepoInfo | null>();
  });

  it('session:create requires PTY dimensions and returns a Session', () => {
    expectTypeOf<IpcRequest<'session:create'>>().toEqualTypeOf<{
      name: string;
      baseBranch: string;
      initialPrompt?: string;
      cols: number;
      rows: number;
    }>();
    expectTypeOf<IpcResponse<'session:create'>>().toEqualTypeOf<Session>();
  });

  it('session:sendInput and session:resize address a single session', () => {
    expectTypeOf<IpcRequest<'session:sendInput'>>().toEqualTypeOf<{ id: string; text: string }>();
    expectTypeOf<IpcRequest<'session:resize'>>().toEqualTypeOf<{
      id: string;
      cols: number;
      rows: number;
    }>();
  });

  it('session events carry the expected payloads', () => {
    expectTypeOf<IpcEventPayload<'session:output'>>().toEqualTypeOf<{
      id: string;
      chunk: string;
    }>();
    expectTypeOf<IpcEventPayload<'session:exit'>>().toEqualTypeOf<{ id: string; code: number }>();
    expectTypeOf<IpcEventPayload<'session:added'>>().toEqualTypeOf<{ session: Session }>();
    expectTypeOf<IpcEventPayload<'session:removed'>>().toEqualTypeOf<{ id: string }>();
  });

  it('session:replayBuffer returns the rolling buffer as a string', () => {
    expectTypeOf<IpcRequest<'session:replayBuffer'>>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<IpcResponse<'session:replayBuffer'>>().toEqualTypeOf<string>();
  });

  it('session:close and session:closeAll are fire-and-forget', () => {
    expectTypeOf<IpcRequest<'session:close'>>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<IpcResponse<'session:close'>>().toEqualTypeOf<undefined>();
    expectTypeOf<IpcRequest<'session:closeAll'>>().toEqualTypeOf<undefined>();
    expectTypeOf<IpcResponse<'session:closeAll'>>().toEqualTypeOf<undefined>();
  });
});
