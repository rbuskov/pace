import type {
  IpcChannel,
  IpcEventChannel,
  IpcEventPayload,
  IpcRequest,
  IpcResponse,
} from '@shared/types';

// The preload script exposes this on `window.pace`. We re-wrap it here so the
// renderer code calls a typed surface instead of dealing with `unknown`s.

interface RawApi {
  home: string | null;
  platform: NodeJS.Platform;
  invoke(channel: string, payload?: unknown): Promise<unknown>;
  on(channel: string, listener: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    pace: RawApi;
  }
}

const raw: RawApi = window.pace;

// `void` request channels are called with no second argument. To keep the type
// signature clean we narrow on the request type at the call site.
export function invoke<C extends IpcChannel>(
  channel: C,
  ...payload: IpcRequest<C> extends void ? [] : [IpcRequest<C>]
): Promise<IpcResponse<C>> {
  return raw.invoke(channel, payload[0] as unknown) as Promise<IpcResponse<C>>;
}

export function on<C extends IpcEventChannel>(
  channel: C,
  listener: (payload: IpcEventPayload<C>) => void,
): () => void {
  return raw.on(channel, (payload) => listener(payload as IpcEventPayload<C>));
}

export const home: string | null = raw.home;
export const platform: NodeJS.Platform = raw.platform;
