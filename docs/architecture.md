# Architecture

## Overview

**Pace** is an Electron desktop app that runs and manages multiple
[Claude Code](https://www.npmjs.com/package/@anthropic-ai/claude-code)
sessions, each in its own git worktree under `.worktrees/` inside a target
repository. The UI is a sidebar listing sessions (with status badges) and a
detail pane showing the focused session's terminal.

The goal of v1 is to make it cheap to spin up a new Claude Code session on a
new branch without leaving the keyboard, and to make it easy to glance at the
sidebar and see which sessions are working, idle, or waiting for input.

## Platforms and distribution

- **macOS and Linux** are first-class. Windows is best-effort — the
  prebuilt node-pty fork we use supports it, but we don't actively test it
  in v1.
- **v1 ships dev-mode only**: `pnpm dev` from a clone. No installer, no
  code signing, no auto-update. Productionizing distribution is a post-v1
  concern.

## Process model

Standard Electron two-process model:

- **Main process** (Node.js): owns all PTYs, runs all git commands, performs
  all filesystem persistence. No UI.
- **Renderer process** (Chromium): React + xterm.js. Pure presentation and
  user input. Cannot touch the filesystem or spawn processes directly.

All communication is over IPC. The renderer emits intents and subscribes to
events; it never reaches around the main process.

## Key modules

### Main process

- `repo-manager` — stores and validates the current repo path; persists it
  between launches.
- `worktree-manager` — creates and lists worktrees inside
  `<repo>/.worktrees/`. Wraps the `git worktree` CLI.
- `session-manager` — owns a map of `Session` objects. Each session has a
  node-pty handle, a rolling output buffer, a status, and metadata. Handles
  PTY lifecycle (spawn, write, kill, exit).
- `status-detector` — subscribes to each session's output stream and emits
  status transitions (`idle` ⇄ `working` ⇄ `awaiting-input`).
- `persistence` — serializes session metadata and the current repo path to
  JSON in the app's `userData` directory.
- `claude-resolver` — finds the `claude` binary (PATH lookup or settings
  override), caches `claude --version` success, exposes a `ready: boolean`
  the renderer reads.
- `ipc` — typed wrapper around `ipcMain`. Exposes request/response intents
  and broadcasts events to all renderers.

### Renderer process

- `app-shell` — header (repo path + switch button + claude-not-found
  banner if applicable) plus sidebar/detail split.
- `session-list` — sidebar; renders sessions with status badge and
  last-activity timestamp.
- `session-view` — the xterm.js terminal bound to the focused session's
  output stream.
- `new-session-form` — modal with name, base branch, and initial-prompt
  textarea.
- `settings-modal` — opened with `Cmd/Ctrl+,`. Holds user-facing settings
  (see *Settings* below).
- `ipc-client` — typed wrapper around `ipcRenderer.invoke` and
  `ipcRenderer.on`. Single source of truth for the IPC contract.

## Data model

```ts
type SessionStatus = 'idle' | 'working' | 'awaiting-input';

interface Session {
  id: string;                  // uuid v4
  name: string;                // also the branch and worktree dir name
  worktreePath: string;        // absolute
  baseBranch: string;
  createdAt: number;           // epoch ms
  lastActivityAt: number;      // epoch ms; updated on any PTY output
  status: SessionStatus;
  ptyAlive: boolean;           // false after process exit or restart
  initialPrompt?: string;
}

interface RepoInfo {
  path: string;                // absolute
  name: string;                // basename of path
  defaultBranch: string;       // detected at selection time
}

interface Settings {
  claudeBinaryPath?: string;       // empty = PATH lookup
  autoResumeConversations: boolean;// default true; used by slice 5
  notifyOnAwaitingInput: boolean;  // default false; used by slice 4
}
```

## IPC contract

**Intents** (renderer → main, request/response):

| Channel               | Payload                                   | Returns         |
| --------------------- | ----------------------------------------- | --------------- |
| `repo:select`         | `{ path }`                                | `RepoInfo`      |
| `repo:current`        | —                                         | `RepoInfo \| null` |
| `session:create`      | `{ name, baseBranch, initialPrompt }`     | `Session`       |
| `session:list`        | —                                         | `Session[]`     |
| `session:sendInput`   | `{ id, text }`                            | `void`          |
| `session:resume`      | `{ id }`                                  | `Session`       |
| `session:forget`      | `{ id }`                                  | `void`          |
| `session:replayBuffer`| `{ id }`                                  | `string`        |
| `settings:get`        | —                                         | `Settings`      |
| `settings:update`     | `Partial<Settings>`                       | `Settings`      |
| `claude:status`       | —                                         | `{ ready, version?, error? }` |

**Events** (main → renderer, broadcast):

| Channel                   | Payload                       |
| ------------------------- | ----------------------------- |
| `session:output`          | `{ id, chunk }`               |
| `session:status-changed`  | `{ id, status }`              |
| `session:exit`            | `{ id, code }`                |
| `session:added`           | `{ session }`                 |
| `session:updated`         | `{ session }`                 |
| `claude:status-changed`   | `{ ready, version?, error? }` |

## Filesystem layout

- `<repo>/.worktrees/<session-name>/` — git worktrees. Owned by the user's
  git, not the app. We never `rm -rf` these; removal is always
  `git worktree remove`.
- `<userData>/state.json` — current repo path, sessions, settings.
- `<userData>/logs/<sessionId>.log` — full output capture, rotated.

## Critical flows

### New session

1. Renderer submits `session:create` with `{ name, baseBranch, initialPrompt }`.
2. Main validates: `name` is non-empty, slug-safe, not already a branch or
   worktree dir; `baseBranch` resolves to a real ref.
3. `worktree-manager` runs
   `git worktree add .worktrees/<name> -b <name> <baseBranch>` from the
   repo root.
4. `session-manager` spawns `claude` (via `claude-resolver`) using node-pty,
   with `cwd = <worktreePath>`. PTY dimensions come from the renderer.
5. After PTY ready (first chunk or a short timer), writes
   `<initialPrompt>\r` into the PTY as a single write — embedded newlines
   in the prompt are preserved and Claude Code's input box handles them.
6. Persists the session, broadcasts `session:added`.
7. Renderer focuses the new session and attaches its xterm.js to the output
   stream.

### Output streaming

For every PTY `data` event, the main process:

- appends to that session's log file on disk,
- appends to the **rolling buffer** (last ~256 KB, used for status detection
  and replay on focus switch),
- updates `lastActivityAt`,
- runs the **status detector**,
- broadcasts `session:output { id, chunk }`.

Log write happens before the broadcast so the renderer never sees output the
next restart won't.

### Focus switching

When the user clicks a different session in the sidebar:

1. Renderer disposes (or hides) the current xterm.js instance.
2. Renderer requests `session:replayBuffer { id }`. Main returns the rolling
   buffer.
3. Renderer writes the buffer into a fresh xterm.js, then subscribes to
   `session:output` for that id.

### Status detection

On each chunk, the detector evaluates the rolling buffer:

- **Working** if recent output contains spinner glyphs (braille patterns)
  or "esc to interrupt" hints.
- **Awaiting input** if the latest screen contains a known confirmation
  pattern (e.g. "Do you want to proceed?") and no working indicator.
- **Idle** as default, after a debounce of quiet output.

The detector is heuristic; calibration happens in slice 4 against a fixture
corpus.

### Restart

On launch:

1. Read `state.json`. If it points to a repo, validate it still exists.
2. Load session metadata. For each session, mark `ptyAlive = false`.
3. Tail the last ~64 KB of each session's log into its rolling buffer so
   focus-replay shows recent history.
4. Render the sidebar; dead sessions show a "Resume" affordance.

### Repo switching with live sessions

When the user picks a new repo while sessions are running:

1. Renderer shows a confirmation dialog: "This will close N running
   session(s). Worktrees and logs are kept. Continue?"
2. On confirm, main kills all PTYs, leaves worktrees and logs on disk,
   updates `state.json` with the new repo path, and reloads that repo's
   session list (empty unless the user has previously used Pace there).

## Tech stack

- **Electron + electron-vite** — Vite-native, fast HMR, less boilerplate
  than Electron Forge.
- **pnpm** — package manager.
- **React + TypeScript + Tailwind** — UI. No global state library; local
  React state is enough.
- **Biome** — linter + formatter in one config.
- **Vitest** — test runner. Tests are required only for the status
  detector (slice 4) and a couple of IPC smoke tests. No coverage target
  in v1.
- **`@homebridge/node-pty-prebuilt-multiarch`** — PTYs. Prebuilt binaries
  avoid the electron-rebuild dance.
- **xterm.js + xterm-addon-fit + xterm-addon-web-links** — terminal
  rendering.
- **simple-git** — thin wrapper around the `git` CLI.
- **electron-store** — JSON persistence under `userData`.
- **sonner** — toast notifications.
- **GitHub Actions** — typecheck + vitest on PR. No e2e in v1.

## UI conventions

- **Theme**: dark only in v1. Accent palette per slice 4: amber for
  *working*, red for *awaiting input*, slate for *idle*.
- **Terminal font stack**:
  `'JetBrains Mono', 'Cascadia Code', Menlo, Consolas, monospace`.
- **Window defaults**: 1200×800. Sidebar 280px, horizontally resizable
  between 240px and 480px, not collapsible.
- **Errors**: form validation errors render inline in the offending
  field; runtime errors (PTY crash, git failure mid-operation) go to
  sonner toasts; session-level errors (worktree missing, claude not
  found) render as a red banner in the detail pane.

## Keyboard shortcuts

- `Cmd/Ctrl+N` — open the New Session modal.
- `Cmd/Ctrl+1..9` — switch focus to the Nth session in the sidebar (by
  visible order).
- `Cmd/Ctrl+,` — open the Settings modal.
- No keyboard shortcut for closing/forgetting a session — context menu
  only (too easy to lose work otherwise).

## Settings

Settings live in `state.json` under a `settings` object. The settings
modal exposes:

- **Claude binary path** (string, default empty = PATH lookup) — added in
  slice 1.
- **Auto-resume Claude Code conversations** (bool, default true) — added
  in slice 5.
- **Desktop notifications on awaiting-input** (bool, default false) —
  added in slice 4.

All other state (window size, sidebar width, last-viewed-at per session)
lives in `state.json` but is not user-editable.

## Behavioral defaults

- **claude binary resolution**: PATH lookup by default; settings override
  wins if set. At startup, run `claude --version` once and cache the
  result via `claude-resolver`. If it fails, the New Session button is
  disabled and a header banner reads "Claude Code not found — set path
  in settings".
- **Branch naming**: the session name *is* the branch name and the
  worktree directory name. There is no separate "branch override" field
  in v1.
- **Multi-line initial prompts**: the entire string, including embedded
  newlines, is written to the PTY as a single chunk ending with `\r`.
  Claude Code's input box handles multi-line itself.
- **Concurrency**: no hard cap. A soft toast warning fires the first
  time the user crosses 10 simultaneous live sessions in a run.

## Non-goals for v1

- Merging worktrees back into the main branch or opening PRs from the
  UI.
- Deleting worktrees from the UI (do it manually with
  `git worktree remove`).
- Working with multiple repos simultaneously (one at a time; switching
  is supported).
- Reattaching to a live `claude` process started outside the app.
- Mobile / web access.
- Installers, code signing, auto-update.

These are intentionally deferred so v1 stays small enough to ship.
