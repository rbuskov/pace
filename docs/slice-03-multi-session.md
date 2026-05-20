# Slice 03 — Multi-session sidebar and switching

## Goal

Make the app actually multiplexed. The user can create more than one session,
all running concurrently in their own worktrees and PTYs. Clicking a session
in the sidebar swaps the detail pane to that session's terminal, with full
scrollback intact. The previous focus does not lose any output.

## User-visible outcome

- The sidebar now lists every active session, newest at the top.
- Each row shows the session name, a small "running" indicator (a colored
  dot — real status badges arrive in slice 4), and a relative
  last-activity timestamp ("now", "2m ago", "1h ago") that updates.
- Clicking a row makes it the focused session. The detail pane reattaches
  to that session's terminal — including everything that scrolled by while
  the user was looking elsewhere.
- A faint highlight on a non-focused row signals new output since the user
  last looked at it.
- The header bar shows "<repo-name> · <session-count> sessions".
- Creating a second session while the first is running does not interrupt
  or steal focus from the first unless the user explicitly opts to focus
  the new one (a checkbox in the New Session modal, "Switch to new
  session", on by default).

## In scope

- `session-manager` lifecycle extended: it now genuinely holds an arbitrary
  number of sessions, each with its own PTY, rolling buffer (~256 KB ring
  buffer; older bytes dropped), and last-activity timestamp.
- Rolling output buffer implementation. Choose one of:
  - a fixed-size `Buffer` with a write cursor (best), or
  - a list of chunks with a total-bytes accounting and trim-from-front.
- `session:replayBuffer { id }` IPC fully implemented; returns the buffer
  contents as a string (it's already ANSI-encoded — xterm.js parses it).
- `session-list` component:
  - Real list rendering, sorted by `createdAt` descending.
  - "Unread" indicator: each row tracks the most recent `session:output`
    event timestamp; if newer than `lastViewedAt` (renderer-side state),
    show the indicator. Clicking a row updates `lastViewedAt`.
  - Last-activity timestamp formatted with a small interval-based
    re-render (every 30s) — no need for per-row timers.
- `session-view` switching:
  - On focus change: dispose the existing xterm.js instance, mount a
    fresh one, call `session:replayBuffer`, `term.write(buffer)`, then
    subscribe to `session:output` for the new id.
  - Cache the scroll position per session in renderer state so the user
    returns to where they left off (xterm.js scroll position, not just
    "stick to bottom").
- `session:added` and `session:output` broadcasts already exist; the
  renderer now actually wires them up to the list.
- **Keyboard shortcuts**: `Cmd/Ctrl+1..9` switches focus to the Nth
  session in the sidebar (by current visible order, newest at top).
  Bound at the app shell level.
- **Soft concurrency warning**: the first time the user crosses 10
  simultaneously live sessions during a run, a sonner toast appears:
  "You have 10+ live sessions — performance may degrade." Fires once
  per app launch, not every additional session.
- **Repo switching with live sessions**: now that sessions can exist,
  switching repos from the header opens a confirmation dialog:
  "This will close N running session(s). Worktrees and logs are kept.
  Continue?" On confirm, main kills all PTYs (graceful then forced as in
  slice 2), updates the repo path, and reloads the sidebar (empty until
  slice 5 restores per-repo session lists).

## Out of scope (later slices)

- Status detection (idle/working/awaiting-input). The "running" dot is a
  placeholder; slice 4 replaces it.
- Persistence across restarts. All sessions still die with the app.
- Closing or removing sessions from the UI. (Add a `session:close` IPC
  stub here — the renderer doesn't expose a button for it yet, but the
  contract is wired so slice 5 can use it.)
- Keyboard navigation beyond direct index switching (no next/prev,
  no `Cmd+W` close shortcut — context menu only).

## Implementation notes

- **Ring buffer**: 256 KB is plenty for status detection and for "what was
  on screen when I switched away". For longer history, slice 5 introduces
  an on-disk log; the in-memory buffer stays bounded.
- **Multiple PTYs**: node-pty has no problem with many concurrent PTYs.
  Each gets its own dimensions, sized to the detail pane at the moment of
  spawn. When a session is in the background, its PTY size stays whatever
  it was last set to — that's fine for Claude Code.
- **Resize on focus**: when a session becomes focused, after writing the
  replay buffer, send a fresh `pty.resize` based on the current detail
  pane size. This handles the case where the window was resized while the
  session was in the background.
- **Scroll position cache**: xterm.js exposes `term.buffer.active.viewportY`
  and `term.scrollToLine(n)`. Save the value before disposing on blur,
  restore after writing the replay buffer on focus.
- **Output throttling for unfocused sessions**: still broadcast every chunk
  so the unread indicator is accurate, but consider batching the buffer
  writes if profiling shows IPC overhead. Probably not needed for v1.
- **Per-row timestamps**: use a single top-level "now" tick (one
  `setInterval(..., 30_000)`) that triggers a re-render; each row computes
  its relative time from `lastActivityAt`. Avoids N timers.

## Acceptance criteria

1. Create three sessions in a row, leaving them all running. All three
   show in the sidebar with distinct names.
2. Switching between them shows the correct terminal content for each,
   including output that arrived while the user was looking at a
   different session.
3. The "unread" indicator appears on background sessions that produce
   new output, and clears on focus.
4. Relative timestamps update at least once a minute without manual
   refresh.
5. Resizing the window mid-conversation does not garble any of the
   foreground or background sessions when re-focused.
6. Quitting the app terminates all `claude` processes (none orphaned).
7. The "Switch to new session" checkbox in the modal correctly controls
   focus behavior when a new session is created.
8. `Cmd/Ctrl+1`, `Cmd/Ctrl+2`, `Cmd/Ctrl+3` switch focus to the 1st,
   2nd, 3rd sidebar entries respectively. Out-of-range indices (e.g.
   `Cmd/Ctrl+5` with only three sessions) are no-ops.
9. Spinning up the 10th simultaneous live session shows a sonner toast
   warning. Closing one and creating another does *not* re-fire the
   toast within the same launch.
10. Clicking "Change…" in the header while sessions are running opens a
    confirmation dialog naming the count. Cancel leaves everything
    untouched; confirm kills the PTYs (verifiable with `ps`) and
    reloads the sidebar empty.

## Done when…

The developer can have three Claude Code sessions chewing through
different tasks in different worktrees, glance at the sidebar to see
which ones produced new output, and switch between them without losing
state. The status dots are still all the same color — that's the next
slice's problem.
