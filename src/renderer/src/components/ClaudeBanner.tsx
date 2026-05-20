import type { ClaudeStatus } from '@shared/types';
import type { FC } from 'react';

interface Props {
  status: ClaudeStatus | null;
  onOpenSettings: () => void;
}

export const ClaudeBanner: FC<Props> = ({ status, onOpenSettings }) => {
  if (!status || status.ready) return null;
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 border-b border-red-900 bg-red-950/70 px-4 py-2 text-sm text-red-100"
    >
      <span>
        Claude Code not found — set path in{' '}
        <button
          type="button"
          onClick={onOpenSettings}
          className="underline underline-offset-2 hover:text-white"
        >
          Settings
        </button>
        .{status.error ? <span className="ml-2 text-red-300/80">({status.error})</span> : null}
      </span>
    </div>
  );
};
