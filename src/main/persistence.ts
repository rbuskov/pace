import Store from 'electron-store';
import { DEFAULT_SETTINGS, type PersistedState, type Settings } from '@shared/types';

const DEFAULTS: PersistedState = {
  schemaVersion: 1,
  repoPath: null,
  sessions: [],
  settings: { ...DEFAULT_SETTINGS },
};

// electron-store types are a touch awkward across versions; the runtime is fine
// with our PersistedState shape.
const store = new Store<PersistedState>({
  name: 'state',
  defaults: DEFAULTS,
});

export function getRepoPath(): string | null {
  return store.get('repoPath');
}

export function setRepoPath(path: string | null): void {
  store.set('repoPath', path);
}

export function getSettings(): Settings {
  // Merge against defaults so a partially-written file still produces a full object.
  return { ...DEFAULT_SETTINGS, ...store.get('settings') };
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next: Settings = { ...getSettings(), ...patch };
  store.set('settings', next);
  return next;
}
