import type { SessionStatus } from '@shared/types';
import type { FC } from 'react';

interface Props {
  status: SessionStatus;
  ptyAlive: boolean;
  size?: 'sm' | 'md';
}

const LABEL: Record<SessionStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  'awaiting-input': 'Awaiting input',
};

// Colors match the slice 4 palette declared in tailwind.config.js.
const COLOR: Record<SessionStatus, string> = {
  idle: 'bg-status-idle',
  working: 'bg-status-working animate-pulse',
  'awaiting-input': 'bg-status-awaiting',
};

export const StatusBadge: FC<Props> = ({ status, ptyAlive, size = 'sm' }) => {
  // Exited sessions render a flat slate dot regardless of last-known status —
  // there's nothing happening, so "Working" or "Awaiting" would be a lie.
  if (!ptyAlive) {
    return (
      <span
        aria-label="exited"
        title="Exited"
        className="inline-block h-2 w-2 shrink-0 rounded-full bg-slate-600"
      />
    );
  }
  const dim = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5';
  return (
    <span
      aria-label={LABEL[status]}
      title={LABEL[status]}
      className={`inline-block shrink-0 rounded-full ${dim} ${COLOR[status]}`}
    />
  );
};
