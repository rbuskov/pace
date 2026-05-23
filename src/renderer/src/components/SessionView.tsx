import type { Session } from '@shared/types';
import { type FC, useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import { invoke, on } from '../ipc-client.js';

interface Props {
  session: Session;
  getScrollPosition: (id: string) => number | undefined;
  saveScrollPosition: (id: string, line: number) => void;
}

// Slate-950 background; everything else inherits from the user's claude theme.
const TERMINAL_THEME = {
  background: '#020617',
  foreground: '#e2e8f0',
  cursor: '#e2e8f0',
  cursorAccent: '#020617',
  selectionBackground: '#334155',
} as const;

const RESIZE_THROTTLE_MS = 50;

export const SessionView: FC<Props> = ({ session, getScrollPosition, saveScrollPosition }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionId = session.id;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      theme: TERMINAL_THEME,
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', Menlo, Consolas, monospace",
      fontSize: 13,
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    term.open(container);
    // Initial fit on mount.
    try {
      fit.fit();
    } catch {
      // ignore — happens when container has 0 size in tests.
    }

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        try {
          fit.fit();
          const { cols, rows } = term;
          void invoke('session:resize', { id: sessionId, cols, rows });
        } catch {
          // ignore
        }
      }, RESIZE_THROTTLE_MS);
    };

    const ro = new ResizeObserver(() => scheduleResize());
    ro.observe(container);

    // Pipe keystrokes back to the PTY.
    const dataDisp = term.onData((text) => {
      void invoke('session:sendInput', { id: sessionId, text });
    });

    // Subscribe to PTY output for this session.
    const offOutput = on('session:output', (payload) => {
      if (payload.id === sessionId) {
        term.write(payload.chunk);
      }
    });

    // Replay rolling buffer, then resize PTY to current dimensions and restore
    // scroll position from before this session was last blurred (if any).
    void invoke('session:replayBuffer', { id: sessionId }).then((buffered) => {
      if (buffered) term.write(buffered);
      try {
        fit.fit();
        const { cols, rows } = term;
        void invoke('session:resize', { id: sessionId, cols, rows });
      } catch {
        // ignore
      }
      const savedLine = getScrollPosition(sessionId);
      if (savedLine !== undefined) {
        // xterm.js writes are buffered; defer the scroll until they're applied.
        queueMicrotask(() => {
          try {
            term.scrollToLine(savedLine);
          } catch {
            // ignore
          }
        });
      }
    });

    term.focus();

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      // Capture scroll position before disposing so a future remount can
      // restore the viewport.
      try {
        saveScrollPosition(sessionId, term.buffer.active.viewportY);
      } catch {
        // ignore
      }
      ro.disconnect();
      dataDisp.dispose();
      offOutput();
      term.dispose();
    };
  }, [sessionId, getScrollPosition, saveScrollPosition]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-950">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-2 text-sm">
        <div className="flex items-center gap-3">
          <span className="font-medium">{session.name}</span>
          <span className="text-xs text-slate-500">
            {session.ptyAlive ? '(running)' : '(exited)'}
          </span>
        </div>
        <span className="truncate text-xs text-slate-500" title={session.worktreePath}>
          {session.worktreePath}
        </span>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden p-2" />
    </div>
  );
};
