import type { RepoInfo } from '@shared/types';
import { type FC, useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  repo: RepoInfo;
  existingNames: string[];
  onClose: () => void;
  onSubmit: (values: {
    name: string;
    baseBranch: string;
    initialPrompt: string;
    switchToNew: boolean;
  }) => Promise<void>;
}

const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/;

function validateName(name: string, existing: string[]): string | null {
  if (!name) return 'Name is required.';
  if (name.length > 64) return 'Name must be 64 characters or fewer.';
  if (!SLUG_RE.test(name)) {
    return 'Use lowercase letters, digits, `.`, `_`, `-`. Must start with a letter or digit.';
  }
  if (existing.includes(name)) return 'A session with that name already exists.';
  return null;
}

export const NewSessionForm: FC<Props> = ({ open, repo, existingNames, onClose, onSubmit }) => {
  const [name, setName] = useState('');
  const [baseBranch, setBaseBranch] = useState(repo.defaultBranch);
  const [initialPrompt, setInitialPrompt] = useState('');
  const [switchToNew, setSwitchToNew] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  // Reset state on each open so re-opening is clean.
  useEffect(() => {
    if (open) {
      setName('');
      setBaseBranch(repo.defaultBranch);
      setInitialPrompt('');
      setSwitchToNew(true);
      setSubmitting(false);
      setSubmitError(null);
      // Focus the name field once the modal mounts.
      queueMicrotask(() => nameRef.current?.focus());
    }
  }, [open, repo.defaultBranch]);

  // Esc closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const nameError = name.length > 0 ? validateName(name, existingNames) : null;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const err = validateName(name, existingNames);
      if (err) {
        setSubmitError(err);
        return;
      }
      if (!baseBranch.trim()) {
        setSubmitError('Base branch is required.');
        return;
      }
      setSubmitting(true);
      setSubmitError(null);
      try {
        await onSubmit({ name, baseBranch: baseBranch.trim(), initialPrompt, switchToNew });
      } catch (e2) {
        setSubmitError((e2 as Error).message ?? 'Failed to create session.');
        setSubmitting(false);
      }
    },
    [name, baseBranch, initialPrompt, switchToNew, existingNames, onSubmit],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <dialog
        open
        aria-modal="true"
        aria-labelledby="new-session-title"
        className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-xl"
      >
        <form onSubmit={handleSubmit}>
          <h2 id="new-session-title" className="mb-4 text-base font-semibold">
            New Session
          </h2>

          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Name
            </span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="add-readme"
              spellCheck={false}
              autoComplete="off"
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              aria-invalid={nameError !== null}
              aria-describedby={nameError ? 'name-error' : undefined}
            />
            {nameError ? (
              <p id="name-error" role="alert" className="mt-1 text-xs text-red-400">
                {nameError}
              </p>
            ) : (
              <p className="mt-1 text-xs text-slate-500">
                Used as the branch name and worktree directory.
              </p>
            )}
          </label>

          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Base branch
            </span>
            <input
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              placeholder={repo.defaultBranch}
              spellCheck={false}
              autoComplete="off"
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </label>

          <label className="mb-4 block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Initial prompt
            </span>
            <textarea
              value={initialPrompt}
              onChange={(e) => setInitialPrompt(e.target.value)}
              rows={4}
              placeholder="Add a README explaining the project"
              className="w-full resize-y rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </label>

          <label className="mb-4 flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={switchToNew}
              onChange={(e) => setSwitchToNew(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-950"
            />
            Switch to new session
          </label>

          {submitError ? (
            <p role="alert" className="mb-3 text-sm text-red-400">
              {submitError}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || nameError !== null || name.length === 0}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
};
