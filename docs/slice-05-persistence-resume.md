# Slice 05 — Persistence and resume

## Goal

Survive a restart. After this slice, sessions the user created in a previous
run of the app still appear in the sidebar, with their full output history,
ready to be resumed (a fresh `claude` process spawned in the same worktree)
or dismissed.

This is the slice that turns the app from a session launcher into a session
manager.

## User-visible outcome

- Quitting the app and relaunching restores the same repo (already true)
  **and** every session the user created.
- Each restored session appears in the sidebar with its name, last
  activity, and a **Resume** badge (instead of a live status pill).
- Clicking a dead session opens its detail pane and shows the last screen
  of output it had before the app quit, scrollable, plus a banner across
  the top: "Session not running. **[Resume]** spawns a fresh Claude Code
  in this worktree."
- Clicking **Resume** spawns a new `claude` in that worktree. The session
  is live again — status badges return to working/idle/awaiting-input as
  in slice 4. The previous transcript stays visible above a divider line
  ("— resumed at 14:23 —"), and the new `claude` instance picks up where
  it left off via its own `--continue` behavior, if available, or just
  starts fresh in that worktree if not.
- Right-clicking a session (or a small "…" menu on each row) gives two
  options: **Resume** (only for dead sessions) and **Forget**. **Forget**
  removes the session from the sidebar and deletes its log file, but
  **does not** touch the worktree on disk — the user keeps that.

## In scope

- **State file** schema upgrade. `state.json` now writes a real
  `sessions` array:
  ```json
  {
    "repoPath": "/Users/me/code/foo",
    "sessions": [
      {
        "id": "...", "name": "add-readme", "worktreePath": "...",
        "baseBranch": "main", "createdAt": 1700000000000,
        "lastActivityAt": 1700000900000, "lastStatus": "idle",
        "initialPrompt": "..."
      }
    ]
  }
  ```
  Persistence is debounced: writes coalesce on a 500 ms timer, plus a
  flush on app quit (`before-quit`).
- **Log files**: each session writes its full PTY output stream to
  `<userData>/logs/<sessionId>.log` (append-only). On restart, the last
  ~64 KB of the log is read into the session's rolling buffer so the
  replay-on-focus path shows recent history.
- **Schema versioning**: top-level `schemaVersion: 1` field, with a
  migration function ready for future bumps. Loading an unknown future
  version refuses to start rather than corrupting state.
- **Resume flow**:
  - `session:resume { id }` IPC handler.
  - Validates the worktree directory still exists (the user may have
    deleted it). If gone, returns a structured error; the renderer
    surfaces a "Worktree missing — Forget this session?" prompt.
  - Spawns a fresh `claude` in the worktree path, marks `ptyAlive =
    true`, broadcasts `session:updated`.
  - Optionally invokes `claude --continue` if Claude Code supports
    resuming the most recent conversation in that directory (it does
    via the `--continue`/`-c` flag, which picks up the prior session).
    This slice **adds the "Auto-resume Claude Code conversations"
    toggle to the settings modal** (default on); when off, Resume
    spawns a plain `claude` with no `--continue` flag.
- **Forget flow**:
  - `session:forget { id }` IPC handler (rename the slice 3
    `session:close` stub, or add a new intent).
  - Kills the PTY if alive, removes the session from state, deletes the
    log file. Leaves `.worktrees/<name>` alone.
- **Renderer**:
  - Distinct rendering for dead sessions: muted row, "Resume" badge in
    place of the status pill, no relative-time tick (timestamp frozen).
  - Banner component for the detail pane when viewing a dead session.
  - Context menu (or "…" button) per row.
- **Log rotation**: if any log file exceeds 8 MB, truncate to the last
  4 MB on next session boot. Quick and dirty; this is not a logging
  product.

## Out of scope (intentional)

- Removing the worktree from disk when forgetting. Users can run
  `git worktree remove` themselves; we don't want to be responsible for
  destroying their work.
- Searching across session logs.
- Exporting transcripts.
- Encrypting log files.
- Live sync between multiple app windows on the same machine. Single
  instance lock from slice 1 already prevents this.

## Implementation notes

- **What survives, what doesn't**: only metadata and the on-disk log
  survive. The PTY itself is gone — a "resumed" session is a brand-new
  process. The continuity comes from being in the same worktree and
  (optionally) Claude Code's own `--continue`.
- **`--continue` detection**: don't hardcode behavior. Probe once at app
  startup: `claude --help` and parse for the flag. Cache the result.
- **Worktree drift**: between app sessions, the user might delete the
  worktree manually. On startup, validate each session's `worktreePath`
  exists; if not, mark the session as `worktreeMissing` and offer
  **Forget** only.
- **Write ordering**: log writes go to disk before broadcasting
  `session:output` to the renderer. Avoids the case where the renderer
  sees output the next restart won't.
- **State write debounce**: `lastActivityAt` changes on every chunk;
  writing the entire state file every chunk would thrash. Debounce
  updates to lastActivityAt and lastStatus on a 500 ms timer; flush on
  any structural change (session added/removed) and on quit.
- **Quit handling**: in `before-quit`, kill all PTYs, await log file
  drains, flush the state file, then allow the app to exit. Add a small
  timeout (3s) to avoid hanging on stuck file handles.

## Acceptance criteria

1. Create three sessions, do some work in each, quit the app.
   `state.json` and three log files exist under `userData`.
2. Relaunch. All three sessions show in the sidebar with a **Resume**
   badge and a frozen "5m ago" timestamp.
3. Clicking one shows the last screen of output it had. The terminal is
   read-only / inert until **Resume** is clicked.
4. **Resume** on a session whose worktree still exists spawns `claude`
   again; status badges return to live behavior.
5. Manually delete one of the worktrees from disk, restart the app.
   That session shows as **worktree missing**; **Forget** is the only
   action.
6. **Forget** a session, restart the app, confirm it is gone and the
   log file is deleted. Confirm the worktree on disk is untouched.
7. Repeatedly create and idle sessions; `state.json` writes coalesce
   (verify with `fs.watch` or by counting writes) rather than thrashing
   on every output chunk.
8. With a session active and producing output, force-kill the app
   (`kill -9` on the Electron process). Relaunch. The restored session
   has logs up to the last successful flush — no corrupted JSON.

## Done when…

A developer can have sessions running, reboot their machine, open the
app, and see their sessions waiting for them. Resuming any of them is
one click. Forgetting any of them is one click. The worktrees on disk
are theirs to manage.
