import { describe, expectTypeOf, it } from 'vitest';
import type { IpcRequest, IpcResponse, RepoInfo, Settings } from '../src/shared/types.js';
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
});
