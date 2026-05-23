import type { ClaudeStatus, RepoInfo, Session } from '@shared/types';
import { type FC, useCallback, useEffect, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { ClaudeBanner } from './components/ClaudeBanner.js';
import { EmptyState } from './components/EmptyState.js';
import { Header } from './components/Header.js';
import { NewSessionForm } from './components/NewSessionForm.js';
import { SessionView } from './components/SessionView.js';
import { SettingsModal } from './components/SettingsModal.js';
import { Sidebar } from './components/Sidebar.js';
import { invoke, on, platform } from './ipc-client.js';

export const App: FC = () => {
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Initial load.
  useEffect(() => {
    void invoke('repo:current').then(setRepo);
    void invoke('claude:status').then(setClaudeStatus);
    void invoke('session:list').then((list) => {
      setSessions(list);
      if (list.length > 0) setActiveSessionId(list[0].id);
    });
    const offClaude = on('claude:status-changed', setClaudeStatus);
    const offAdded = on('session:added', ({ session }) => {
      setSessions((prev) => (prev.some((s) => s.id === session.id) ? prev : [...prev, session]));
    });
    const offUpdated = on('session:updated', ({ session }) => {
      setSessions((prev) => prev.map((s) => (s.id === session.id ? session : s)));
    });
    const offExit = on('session:exit', ({ id, code }) => {
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ptyAlive: false } : s)));
      toast.message(`Session ${shortId(id)} exited (code ${code})`);
    });
    return () => {
      offClaude();
      offAdded();
      offUpdated();
      offExit();
    };
  }, []);

  const canCreateSession = repo !== null && claudeStatus !== null && claudeStatus.ready;
  const newSessionDisabledReason = !repo
    ? 'Pick a repository first.'
    : !claudeStatus?.ready
      ? 'Claude Code is not available.'
      : undefined;

  // Cmd/Ctrl+, opens Settings; Cmd/Ctrl+N opens New Session.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const modifier = platform === 'darwin' ? e.metaKey : e.ctrlKey;
      if (!modifier) return;
      if (e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (e.key === 'n' || e.key === 'N') {
        if (!canCreateSession) return;
        e.preventDefault();
        setNewSessionOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canCreateSession]);

  const onPickRepo = useCallback(async () => {
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

  const onCreateSession = useCallback(
    async (values: { name: string; baseBranch: string; initialPrompt: string }) => {
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
      setActiveSessionId(created.id);
      setNewSessionOpen(false);
      toast.success(`Session "${created.name}" started`);
    },
    [],
  );

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  return (
    <div className="flex h-full w-full flex-col bg-slate-950 text-slate-100">
      <ClaudeBanner status={claudeStatus} onOpenSettings={() => setSettingsOpen(true)} />
      <Header repo={repo} onPickRepo={onPickRepo} onOpenSettings={() => setSettingsOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={setActiveSessionId}
          onNewSession={() => setNewSessionOpen(true)}
          canCreateSession={canCreateSession}
          newSessionDisabledReason={newSessionDisabledReason}
        />
        <main className="min-w-0 flex-1">
          {activeSession ? (
            <SessionView key={activeSession.id} session={activeSession} />
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
      <Toaster theme="dark" position="bottom-right" />
    </div>
  );
};

function shortId(id: string): string {
  return id.slice(0, 8);
}
