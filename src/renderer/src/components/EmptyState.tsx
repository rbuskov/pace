import type { FC } from 'react';

interface Props {
  hasRepo: boolean;
  onPickRepo: () => void;
  pickError: string | null;
}

export const EmptyState: FC<Props> = ({ hasRepo, onPickRepo, pickError }) => {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      {hasRepo ? (
        <>
          <h2 className="text-xl font-semibold">No sessions yet</h2>
          <p className="max-w-md text-slate-400">
            You can create your first Claude Code session in a later slice.
          </p>
        </>
      ) : (
        <>
          <h2 className="text-xl font-semibold">Welcome to Pace</h2>
          <p className="max-w-md text-slate-400">
            Pick a git repository to manage Claude Code sessions in.
          </p>
          <button
            type="button"
            onClick={onPickRepo}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            Choose folder…
          </button>
          {pickError ? (
            <p role="alert" className="max-w-md text-sm text-red-400">
              {pickError}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
};
