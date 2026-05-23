import type { Session } from '@shared/types';
import { type FC, useCallback, useEffect, useRef, useState } from 'react';
import { formatRelative } from '../util/relativeTime.js';
import { StatusBadge } from './StatusBadge.js';

interface Props {
  width: number;
  onWidthChange: (next: number) => void;
  sessions: Session[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  canCreateSession: boolean;
  newSessionDisabledReason?: string;
  unreadIds: ReadonlySet<string>;
  flashIds: ReadonlySet<string>;
  now: number;
}

const MIN = 240;
const MAX = 480;

export const Sidebar: FC<Props> = ({
  width,
  onWidthChange,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  canCreateSession,
  newSessionDisabledReason,
  unreadIds,
  flashIds,
  now,
}) => {
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      setDragging(true);
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [width],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startXRef.current;
      const next = Math.max(MIN, Math.min(MAX, startWidthRef.current + dx));
      onWidthChange(next);
    };
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, onWidthChange]);

  return (
    <aside
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-r border-slate-800 bg-slate-900"
    >
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs uppercase tracking-wide text-slate-500">Sessions</span>
        <button
          type="button"
          onClick={onNewSession}
          disabled={!canCreateSession}
          title={canCreateSession ? 'New session (Cmd/Ctrl+N)' : newSessionDisabledReason}
          aria-label="New session"
          className="rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          + New Session
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {sessions.length === 0 ? (
          <p className="px-1 text-sm text-slate-500">(no sessions yet)</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {sessions.map((s) => {
              const active = s.id === activeSessionId;
              const unread = !active && unreadIds.has(s.id);
              const flash = !active && flashIds.has(s.id);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onSelectSession(s.id)}
                    className={`flex w-full flex-col rounded border px-2 py-1.5 text-left text-sm transition-colors ${
                      flash ? 'border-amber-400 pace-flash' : 'border-transparent'
                    } ${
                      active
                        ? 'bg-slate-700 text-white'
                        : unread
                          ? 'bg-slate-800/60 text-slate-100 hover:bg-slate-800'
                          : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <StatusBadge status={s.status} ptyAlive={s.ptyAlive} />
                      <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                      {unread ? (
                        <span
                          aria-label="unread output"
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400"
                        />
                      ) : null}
                    </span>
                    <span className="mt-0.5 pl-4 text-xs text-slate-500">
                      {s.ptyAlive ? formatRelative(s.lastActivityAt, now) : '(exited)'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <button
        type="button"
        onPointerDown={onPointerDown}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onWidthChange(Math.max(MIN, width - 16));
          else if (e.key === 'ArrowRight') onWidthChange(Math.min(MAX, width + 16));
        }}
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-blue-500/40"
      />
    </aside>
  );
};
