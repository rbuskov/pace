import type { ClaudeStatus, RepoInfo, Session } from '@shared/types';
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { ClaudeBanner } from './components/ClaudeBanner.js';
import { ConfirmDialog } from './components/ConfirmDialog.js';
import { EmptyState } from './components/EmptyState.js';
import { Header } from './components/Header.js';
import { NewSessionForm } from './components/NewSessionForm.js';
import { SessionView } from './components/SessionView.js';
import { SettingsModal } from './components/SettingsModal.js';
import { Sidebar } from './components/Sidebar.js';
import { invoke, on, platform } from './ipc-client.js';

const NOW_TICK_MS = 30_000;
const SOFT_SESSION_LIMIT = 10;

// Newest first; ptyAlive count is only the live ones (used for the repo-switch
// dialog and the soft warning).
function sortSessions(list: Session[]): Session[] {
  return [...list].sort((a, b) => b.createdAt - a.createdAt);
}

export const App: FC = () => {
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [unreadIds, setUnreadIds] = useState<ReadonlySet<string>>(() => new Set());
  const [flashIds, setFlashIds] = useState<ReadonlySet<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  const [confirmRepoSwitch, setConfirmRepoSwitch] = useState(false);

  // Cached scroll positions per session id; survives focus switches but lives
  // only in this run (no persistence across launches).
  const scrollPositionsRef = useRef<Map<string, number>>(new Map());
  const getScrollPosition = useCallback((id: string) => scrollPositionsRef.current.get(id), []);
  const saveScrollPosition = useCallback((id: string, line: number) => {
    scrollPositionsRef.current.set(id, line);
  }, []);

  // Fire the 10+ sessions toast once per launch.
  const tenSessionWarningFiredRef = useRef(false);

  // Latest focused id without re-triggering effects.
  const activeRef = useRef<string | null>(null);
  useEffect(() => {
    activeRef.current = activeSessionId;
  }, [activeSessionId]);

  // Initial load.
  useEffect(() => {
    void invoke('repo:current').then(setRepo);
    void invoke('claude:status').then(setClaudeStatus);
    void invoke('session:list').then((list) => {
      const sorted = sortSessions(list);
      setSessions(sorted);
      if (sorted.length > 0) setActiveSessionId(sorted[0].id);
    });
    const offClaude = on('claude:status-changed', setClaudeStatus);
    const offAdded = on('session:added', ({ session }) => {
      setSessions((prev) =>
        sortSessions(
          prev.some((s) => s.id === session.id)
            ? prev.map((s) => (s.id === session.id ? session : s))
            : [...prev, session],
        ),
      );
    });
    const offUpdated = on('session:updated', ({ session }) => {
      setSessions((prev) => sortSessions(prev.map((s) => (s.id === session.id ? session : s))));
    });
    const offExit = on('session:exit', ({ id, code }) => {
      setSessions((prev) =>
        sortSessions(prev.map((s) => (s.id === id ? { ...s, ptyAlive: false } : s))),
      );
      toast.message(`Session ${shortId(id)} exited (code ${code})`);
    });
    const offRemoved = on('session:removed', ({ id }) => {
      setSessions((prev) => prev.filter((s) => s.id !== id));
      setUnreadIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setFlashIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      scrollPositionsRef.current.delete(id);
      setActiveSessionId((curr) => (curr === id ? null : curr));
    });
    const offStatus = on('session:status-changed', ({ id, status }) => {
      // session:updated already carries the new status, but listening here lets
      // us trigger the attention flash on the specific transition we care about
      // (idle → awaiting-input on a non-focused row).
      if (status === 'awaiting-input' && activeRef.current !== id) {
        setFlashIds((prev) => {
          if (prev.has(id)) return prev;
          const next = new Set(prev);
          next.add(id);
          return next;
        });
        setTimeout(() => {
          setFlashIds((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }, 4000);
      }
    });
    const offOutput = on('session:output', ({ id }) => {
      // Bump lastActivityAt locally for snappy timestamp updates without
      // waiting for a server-driven session:updated.
      setSessions((prev) => {
        let changed = false;
        const ts = Date.now();
        const next = prev.map((s) => {
          if (s.id === id && s.lastActivityAt !== ts) {
            changed = true;
            return { ...s, lastActivityAt: ts };
          }
          return s;
        });
        return changed ? next : prev;
      });
      if (activeRef.current !== id) {
        setUnreadIds((prev) => {
          if (prev.has(id)) return prev;
          const next = new Set(prev);
          next.add(id);
          return next;
        });
      }
    });
    return () => {
      offClaude();
      offAdded();
      offUpdated();
      offExit();
      offRemoved();
      offOutput();
      offStatus();
    };
  }, []);

  // Aggregate window title — "Pace · N awaiting input" when any sessions are
  // waiting on a confirmation, otherwise plain.
  useEffect(() => {
    const awaiting = sessions.filter((s) => s.ptyAlive && s.status === 'awaiting-input').length;
    document.title = awaiting > 0 ? `Pace · ${awaiting} awaiting input` : 'Pace';
  }, [sessions]);

  // Soft warning toast the first time live sessions cross 10 in a run.
  useEffect(() => {
    if (tenSessionWarningFiredRef.current) return;
    const liveCount = sessions.filter((s) => s.ptyAlive).length;
    if (liveCount >= SOFT_SESSION_LIMIT) {
      tenSessionWarningFiredRef.current = true;
      toast.warning('You have 10+ live sessions — performance may degrade.');
    }
  }, [sessions]);

  // Single top-level "now" tick re-renders rows so relative timestamps stay fresh.
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => clearInterval(i);
  }, []);

  const canCreateSession = repo !== null && claudeStatus !== null && claudeStatus.ready;
  const newSessionDisabledReason = !repo
    ? 'Pick a repository first.'
    : !claudeStatus?.ready
      ? 'Claude Code is not available.'
      : undefined;

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setUnreadIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setFlashIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Cmd/Ctrl+, opens Settings; Cmd/Ctrl+N opens New Session; Cmd/Ctrl+1..9
  // switches focus by visible (sorted) order.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const modifier = platform === 'darwin' ? e.metaKey : e.ctrlKey;
      if (!modifier) return;
      if (e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        if (!canCreateSession) return;
        e.preventDefault();
        setNewSessionOpen(true);
        return;
      }
      // Digit row (not the e.code path) so Shift+1 etc. still works the same.
      if (e.key >= '1' && e.key <= '9') {
        const idx = Number(e.key) - 1;
        if (idx < sessions.length) {
          e.preventDefault();
          selectSession(sessions[idx].id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canCreateSession, sessions, selectSession]);

  const doPickRepo = useCallback(async () => {
    setPickError(null);
    const chosen = await invoke('dialog:pickFolder');
    if (!chosen) return;
    try {
      const next = await invoke('repo:select', { path: chosen });
      setRepo(next);
    } catch (err) {
      setPickError((err as Error).message ?? 'Failed to select repository.');
    }
  }, []);

  const liveSessionCount = useMemo(() => sessions.filter((s) => s.ptyAlive).length, [sessions]);

  const onPickRepo = useCallback(async () => {
    if (liveSessionCount > 0) {
      setConfirmRepoSwitch(true);
      return;
    }
    await doPickRepo();
  }, [liveSessionCount, doPickRepo]);

  const onConfirmRepoSwitch = useCallback(async () => {
    setConfirmRepoSwitch(false);
    try {
      await invoke('session:closeAll');
    } catch (err) {
      toast.error(`Failed to close sessions: ${(err as Error).message}`);
      return;
    }
    // Local state mirrors the broadcasted session:removed events; clear
    // defensively here too, in case any race leaves a row stale.
    setSessions([]);
    setUnreadIds(new Set());
    setFlashIds(new Set());
    setActiveSessionId(null);
    scrollPositionsRef.current.clear();
    await doPickRepo();
  }, [doPickRepo]);

  const onCreateSession = useCallback(
    async (values: {
      name: string;
      baseBranch: string;
      initialPrompt: string;
      switchToNew: boolean;
    }) => {
      // Sensible default until SessionView fits to its real container.
      const cols = 100;
      const rows = 30;
      const created = await invoke('session:create', {
        name: values.name,
        baseBranch: values.baseBranch,
        initialPrompt: values.initialPrompt || undefined,
        cols,
        rows,
      });
      if (values.switchToNew) {
        selectSession(created.id);
      }
      setNewSessionOpen(false);
      toast.success(`Session "${created.name}" started`);
    },
    [selectSession],
  );

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  return (
    <div className="flex h-full w-full flex-col bg-slate-950 text-slate-100">
      <ClaudeBanner status={claudeStatus} onOpenSettings={() => setSettingsOpen(true)} />
      <Header
        repo={repo}
        sessionCount={sessions.length}
        onPickRepo={onPickRepo}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={selectSession}
          onNewSession={() => setNewSessionOpen(true)}
          canCreateSession={canCreateSession}
          newSessionDisabledReason={newSessionDisabledReason}
          unreadIds={unreadIds}
          flashIds={flashIds}
          now={now}
        />
        <main className="min-w-0 flex-1">
          {activeSession ? (
            <SessionView
              key={activeSession.id}
              session={activeSession}
              getScrollPosition={getScrollPosition}
              saveScrollPosition={saveScrollPosition}
            />
          ) : (
            <EmptyState hasRepo={repo !== null} onPickRepo={onPickRepo} pickError={pickError} />
          )}
        </main>
      </div>
      {repo && newSessionOpen ? (
        <NewSessionForm
          open={newSessionOpen}
          repo={repo}
          existingNames={sessions.map((s) => s.name)}
          onClose={() => setNewSessionOpen(false)}
          onSubmit={onCreateSession}
        />
      ) : null}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ConfirmDialog
        open={confirmRepoSwitch}
        title="Switch repository?"
        message={`This will close ${liveSessionCount} running session${liveSessionCount === 1 ? '' : 's'}. Worktrees and logs are kept. Continue?`}
        confirmLabel="Close & switch"
        destructive
        onConfirm={onConfirmRepoSwitch}
        onCancel={() => setConfirmRepoSwitch(false)}
      />
      <Toaster theme="dark" position="bottom-right" />
    </div>
  );
};

function shortId(id: string): string {
  return id.slice(0, 8);
}
