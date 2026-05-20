import type { RepoInfo } from '@shared/types';
import type { FC } from 'react';
import { home } from '../ipc-client.js';
import { displayPath } from '../util/displayPath.js';

interface Props {
  repo: RepoInfo | null;
  onPickRepo: () => void;
  onOpenSettings: () => void;
}

export const Header: FC<Props> = ({ repo, onPickRepo, onOpenSettings }) => {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-4 text-sm">
      <div className="flex min-w-0 items-center gap-3">
        <span className="font-semibold tracking-tight">Pace</span>
        {repo ? (
          <>
            <span className="text-slate-500">•</span>
            <span className="font-medium">{repo.name}</span>
            <span className="truncate text-slate-400" title={repo.path}>
              {displayPath(repo.path, home)}
            </span>
          </>
        ) : (
          <span className="text-slate-500">no repository selected</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {repo ? (
          <button
            type="button"
            onClick={onPickRepo}
            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
          >
            Change…
          </button>
        ) : null}
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Settings"
          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
        >
          Settings
        </button>
      </div>
    </header>
  );
};
