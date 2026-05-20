import type { ClaudeStatus, RepoInfo } from '@shared/types';
import { type FC, useCallback, useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { ClaudeBanner } from './components/ClaudeBanner.js';
import { EmptyState } from './components/EmptyState.js';
import { Header } from './components/Header.js';
import { SettingsModal } from './components/SettingsModal.js';
import { Sidebar } from './components/Sidebar.js';
import { invoke, on, platform } from './ipc-client.js';

export const App: FC = () => {
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);

  // Initial load.
  useEffect(() => {
    void invoke('repo:current').then(setRepo);
    void invoke('claude:status').then(setClaudeStatus);
    const off = on('claude:status-changed', setClaudeStatus);
    return off;
  }, []);

  // Cmd/Ctrl+, opens Settings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const modifier = platform === 'darwin' ? e.metaKey : e.ctrlKey;
      if (modifier && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  return (
    <div className="flex h-full w-full flex-col bg-slate-950 text-slate-100">
      <ClaudeBanner status={claudeStatus} onOpenSettings={() => setSettingsOpen(true)} />
      <Header repo={repo} onPickRepo={onPickRepo} onOpenSettings={() => setSettingsOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <Sidebar width={sidebarWidth} onWidthChange={setSidebarWidth} />
        <main className="min-w-0 flex-1 overflow-auto">
          <EmptyState hasRepo={repo !== null} onPickRepo={onPickRepo} pickError={pickError} />
        </main>
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Toaster theme="dark" position="bottom-right" />
    </div>
  );
};
