# Slice 02 — First working session

## Goal

End-to-end "new session" pipeline. The user clicks **New Session**, fills in
a name + base branch + initial prompt, the app creates a worktree, spawns
`claude` in it via node-pty, writes the prompt, and the detail pane shows a
live xterm.js terminal with Claude Code running.

This is the slice where the app becomes useful for the first time. Everything
in here is "make a single session work, beautifully". Multi-session handling
is the next slice.

## User-visible outcome

- The empty sidebar gains a **+ New Session** button at the top.
- Clicking it opens a modal with three fields: session name, base branch
  (defaulted to the repo's default branch), and an initial-prompt textarea.
- On submit: the modal closes, a single entry appears in the sidebar, and
  the detail pane fills with a working terminal showing Claude Code spinning
  up and immediately acting on the initial prompt.
- The terminal is interactive — typing in it sends keystrokes back to
  Claude Code. Resizing the window resizes the PTY.
- If anything fails (name collision, base branch missing, `claude` binary
  not in PATH), an inline error appears in the modal and no worktree is
  left behind.

## In scope

- `worktree-manager` module that runs
  `git worktree add .worktrees/<name> -b <name> <baseBranch>` and parses
  errors into structured failures.
- `session-manager` module that owns a `Map<id, Session>` and a
  `Map<id, IPty>`. For this slice it only ever has zero or one entry, but
  the data structures are plural-ready.
- node-pty integration:
  - PTY package: **`@homebridge/node-pty-prebuilt-multiarch`** (prebuilt
    binaries, no electron-rebuild needed).
  - Binary path comes from `claude-resolver` (introduced in slice 1) —
    do not re-implement PATH lookup here. If `claude:status.ready` is
    false, the New Session button is disabled and clicking it is a
    no-op.
  - PTY dimensions from the renderer's xterm.js `fit` addon, sent over
    IPC.
  - Graceful kill on app quit (`SIGTERM`, then `SIGKILL` after 2s).
- IPC additions: `session:create`, `session:list`, `session:sendInput`,
  `session:output`, `session:exit`, `session:added`. `session:replayBuffer`
  can return an empty string for now — slice 3 uses it for real.
- Renderer:
  - `new-session-form` modal, opened by clicking the **+ New Session**
    button or pressing `Cmd/Ctrl+N`. Fields: session name (validated
    against slug regex `^[a-z0-9][a-z0-9._-]*$`, max 64 chars), base
    branch (defaults to `RepoInfo.defaultBranch`), and an
    initial-prompt textarea. The session name *is* the branch name and
    the worktree directory name — no separate field.
  - `session-list` with one item.
  - `session-view` mounting xterm.js, hooking up the fit addon to a
    `ResizeObserver`, and bridging keystrokes to `session:sendInput`.
- **Multi-line initial prompts**: the textarea value, including embedded
  newlines, is written to the PTY as a single chunk ending with `\r`.
  Claude Code's input box handles multi-line itself. A short delay
  (default 250 ms) after PTY spawn before this write, to let the splash
  screen settle.
- Runtime errors during spawn (git failure mid-flow, PTY exit before
  prompt write) surface as sonner toasts; form-validation errors stay
  inline in the modal.

## Out of scope (later slices)

- Multiple concurrent sessions and switching between them.
- Status badges; the sidebar item just shows the session name + "(running)".
- Persistence of session metadata across restarts.
- Authentication flows. If `claude` requires login on first run, the
  terminal will show the login URL and the user handles it manually. The
  app does not try to intercept that.
- Detecting that `claude` exists (already handled by slice 1's
  `claude-resolver`). This slice only consumes the result.

## Implementation notes

- **Branch defaulting**: the modal pre-fills `baseBranch` with
  `RepoInfo.defaultBranch`. The user can type anything else; we validate it
  with `git rev-parse --verify <baseBranch>` before attempting the
  worktree add.
- **Name validation** happens in two layers: client-side regex for instant
  feedback, server-side check that
  `.worktrees/<name>` does not already exist and `<name>` is not already a
  branch.
- **Atomicity**: if `git worktree add` succeeds but spawning `claude`
  fails, run `git worktree remove --force .worktrees/<name>` and delete
  the branch (`git branch -D <name>`) before returning the error. The
  worktree is the only artifact that needs cleanup; we have not yet
  persisted the session.
- **PTY resize**: throttle resize events from the renderer to ~50ms, then
  call `pty.resize(cols, rows)`.
- **xterm.js theme**: match the app's dark theme. Use a neutral background
  so Claude Code's own colors come through unchanged.
- **Keystroke piping**: xterm.js `onData` → `ipc.invoke('session:sendInput',
  { id, text })`. Bracketed paste and arrow keys should work without any
  extra handling.

## Acceptance criteria

1. From a fresh app state with a selected repo, the user can click
   **+ New Session**, fill in `add-readme`, base `main`, prompt
   "Add a README explaining the project", and click Create.
2. A directory appears at `<repo>/.worktrees/add-readme` checked out to a
   new branch `add-readme` based on `main`.
3. The detail pane shows Claude Code running, processing the prompt.
4. Typing in the terminal interacts with Claude Code as expected (Tab
   completion, arrow keys, Ctrl-C all work).
5. Submitting with a name that already exists (as a branch or directory)
   shows an inline error and no side effects on disk.
6. Submitting with a missing base branch (`origin/foo` typo) shows an
   error; no worktree is created.
7. Quitting the app terminates the `claude` process within 3 seconds
   (`ps` should show no orphans).
8. Resizing the window changes the dimensions of Claude Code's TUI
   correctly (no garbled output).

## Done when…

The developer can run the app, create one session, watch Claude Code work
on the initial prompt, and interact with it through the terminal as if
they had run `claude` themselves in that worktree.
