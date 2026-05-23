import type { Settings } from '@shared/types';
import { type FC, useEffect, useState } from 'react';
import { invoke } from '../ipc-client.js';

interface Props {
  open: boolean;
  onClose: () => void;
}

export const SettingsModal: FC<Props> = ({ open, onClose }) => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [claudeBinaryPath, setClaudeBinaryPath] = useState('');
  const [notifyOnAwaitingInput, setNotifyOnAwaitingInput] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void invoke('settings:get').then((s) => {
      if (cancelled) return;
      setSettings(s);
      setClaudeBinaryPath(s.claudeBinaryPath ?? '');
      setNotifyOnAwaitingInput(s.notifyOnAwaitingInput);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onSave = async () => {
    setSaving(true);
    try {
      const next = await invoke('settings:update', { claudeBinaryPath, notifyOnAwaitingInput });
      setSettings(next);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <dialog
        open
        aria-modal="true"
        aria-label="Settings"
        className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-xl"
      >
        <h2 className="mb-4 text-lg font-semibold">Settings</h2>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-300">Claude binary path</span>
          <input
            type="text"
            placeholder="(use PATH lookup)"
            value={claudeBinaryPath}
            onChange={(e) => setClaudeBinaryPath(e.target.value)}
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-slate-500">
            Leave blank to look up <code>claude</code> on your PATH.
          </p>
        </label>
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={notifyOnAwaitingInput}
            onChange={(e) => setNotifyOnAwaitingInput(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-950 accent-blue-500"
          />
          <span>
            <span className="block text-slate-200">Desktop notifications on awaiting-input</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Show a system notification when a session starts asking for confirmation.
            </span>
          </span>
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || settings === null}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </dialog>
    </div>
  );
};
