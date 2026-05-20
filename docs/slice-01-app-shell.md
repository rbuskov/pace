# Slice 01 — App shell and repo selection

## Goal

A runnable Electron app that opens to a two-pane window, lets the user pick a
git repository, validates that pick, and remembers it across restarts. No
sessions yet — the sidebar shows an empty state.

This slice establishes the entire skeleton: build tooling, the IPC plumbing,
the persistence layer, and the layout shell. Everything after this builds on
top of it.

## User-visible outcome

- Launching the app shows a window with a header bar, an empty sidebar
  (left), and an empty detail pane (right).
- If no repo has ever been selected, the detail pane prompts the user to
  pick one with a button that opens a native folder picker.
- After picking, the header shows the repo basename and the truncated path,
  with a small "Change…" button.
- Selecting a non-git folder shows an inline error and the previous repo (if
  any) stays selected.
- Closing and reopening the app restores the previously selected repo with
  no prompting.

## In scope

- Project scaffold: **electron-vite** with TypeScript on both sides,
  React + Tailwind in the renderer, **pnpm** as the package manager,
  **Biome** for lint/format. GitHub Actions workflow that runs
  `pnpm typecheck` and `pnpm test` on PR.
- Window defaults: 1200×800, dark theme baseline, sidebar 280px and
  horizontally resizable between 240–480px (not collapsible).
- IPC wrapper modules in main and renderer with the typed contract from
  `architecture.md`. Implemented this slice: `repo:select`,
  `repo:current`, `settings:get`, `settings:update`, `claude:status`,
  and the `claude:status-changed` event.
- `repo-manager` module that:
  - validates a path is a directory containing a `.git` directory or file,
  - runs `git rev-parse --show-toplevel` to canonicalize,
  - runs `git symbolic-ref refs/remotes/origin/HEAD` (with fallbacks) to
    detect the default branch, storing it on `RepoInfo`.
- `persistence` module backed by `electron-store` writing to
  `<userData>/state.json`. Shape:
  ```json
  {
    "schemaVersion": 1,
    "repoPath": "/Users/me/code/foo",
    "sessions": [],
    "settings": {
      "claudeBinaryPath": "",
      "autoResumeConversations": true,
      "notifyOnAwaitingInput": false
    }
  }
  ```
- `claude-resolver` module: on startup, runs `claude --version` (using
  the `claudeBinaryPath` setting if set, otherwise PATH). Caches result
  and exposes it via `claude:status`. If it fails, broadcasts
  `claude:status-changed` with the error.
- `app-shell` component: header + flex sidebar/detail layout. If claude
  resolution failed, a red banner spans the top: "Claude Code not found
  — set path in Settings".
- `settings-modal` component, opened with `Cmd/Ctrl+,`. In this slice it
  exposes only the **Claude binary path** field; slices 4 and 5 add
  their own fields. Changes call `settings:update`; if
  `claudeBinaryPath` changed, `claude-resolver` re-runs.
- `sonner` provider mounted in the app shell for toast notifications
  (used by later slices).
- Empty-state component for the detail pane when no repo is selected.

## Out of scope (later slices)

- Spawning processes, PTYs, or anything to do with `claude` beyond the
  startup `--version` check.
- Anything in the sidebar beyond an "(no sessions yet)" placeholder.
- Restoring session metadata from disk — slice 5 handles that. The
  `sessions` field in `state.json` is written as `[]` and ignored on load
  for this slice.
- The "auto-resume" and "notifications" settings fields — slices 5 and 4
  add them to the modal respectively.
- Repo-switching confirmation dialog — added in slice 3 when there can
  actually be live sessions to kill.

## Implementation notes

- **Single instance**: enable `app.requestSingleInstanceLock()` so the user
  can't open two windows fighting over the same state file.
- **Path display**: use a small utility that collapses `$HOME` to `~` in
  the header for readability.
- **Default-branch detection** has three fallbacks:
  1. `git symbolic-ref --short refs/remotes/origin/HEAD` → strip
     `origin/` prefix.
  2. If that fails, check whether `main` or `master` is the current
     `HEAD`.
  3. Otherwise, store `HEAD` and let later slices treat it as
     "current branch".
- **IPC handle registration** lives in `main/ipc/index.ts`; each module
  exports a `register(ipcMain)` function so future slices add intents in
  one place.
- **Folder picker**: `dialog.showOpenDialog({ properties: ['openDirectory'] })`.
  The renderer asks the main process to open it — don't try to call
  `dialog` from the renderer.

## Acceptance criteria

1. `pnpm dev` builds and launches the app on macOS and Linux.
2. Picking a valid git repo updates the header and writes `state.json`.
3. Picking a non-git folder shows an error and leaves the previous repo (or
   empty state) untouched.
4. Quitting and relaunching restores the same repo with no user
   interaction.
5. The detail pane in the empty-state case shows usable copy explaining
   what to do next ("Pick a git repository to manage Claude Code sessions
   in.").
6. The IPC types compile end-to-end — if the renderer calls
   `repo:select` with the wrong payload shape, TypeScript catches it.
7. `Cmd/Ctrl+,` opens the Settings modal. Setting a custom Claude binary
   path triggers a fresh `claude --version` check; setting it to an
   invalid path surfaces the error banner in the header.
8. On a machine without `claude` in PATH and no override, the app boots,
   shows the "Claude Code not found" banner, and stays usable (repo
   picking still works).
9. `pnpm typecheck` and `pnpm test` both pass in CI on PR.

## Done when…

A developer can clone the repo, `pnpm install && pnpm dev`, point it at
one of their own projects, restart the app, and have the project
remembered. If `claude` is installed, the header is clean; if not, the
banner tells them what to do. That's it. Nothing else works yet.
