# Slice 04 — Status detection and badges

## Goal

Replace the placeholder "running" dot with real status badges:
**idle**, **working**, **awaiting input**. The user should be able to glance
at the sidebar and immediately know which sessions need attention — that's
the whole point of the app, and this slice is where that promise gets
delivered.

Status detection is heuristic. This slice is half implementation, half
calibration against real Claude Code TUI output.

## User-visible outcome

- Each sidebar row shows a colored pill next to the session name:
  - **Working** — amber, animated subtle pulse. "Claude is thinking or
    running a tool."
  - **Awaiting input** — red. "Claude is asking you something." This is
    the one the user cares about most.
  - **Idle** — slate-gray. "Nothing happening right now."
- The badge updates within roughly a second of the underlying state
  changing.
- When a non-focused session transitions to **awaiting input**, the
  sidebar row briefly flashes to draw the eye. Optional (settings):
  desktop notification on that transition.
- The window title reflects aggregate state: "Pace · 2 awaiting input" when
  any are awaiting, otherwise plain.

## In scope

- `status-detector` module in the main process. Plain function, not a
  class:
  ```ts
  function detectStatus(buffer: string, previous: SessionStatus): SessionStatus
  ```
  Operates on the rolling output buffer. Pure given input; easy to test.
- Heuristic rules, in priority order:
  1. **Awaiting input**: the latest screen contains a tool-use
     confirmation prompt. Look for known patterns Claude Code emits, e.g.
     "Do you want to proceed?", numbered choice lines like
     `❯ 1. Yes`, or a "(y/n)" prompt. Pattern set is config, not
     hard-coded — see *Calibration*.
  2. **Working**: the latest output (last ~2 seconds, last ~4 KB of the
     buffer) contains a spinner character (one of the braille spinner
     glyphs Claude Code uses) **and** an interrupt hint like "esc to
     interrupt".
  3. **Idle**: neither of the above for at least 800 ms of quiet (no new
     output chunks).
- Debounce: status changes are not emitted on every chunk. The detector
  runs on each chunk, but only emits via `session:status-changed` when the
  computed status differs from the stored one AND has been stable for
  100 ms (working/awaiting) or 800 ms (idle). This keeps the badge from
  flickering.
- Wiring into `session-manager`: each PTY data handler now fans out to the
  buffer, the status detector, and the event broadcast (it already did the
  first and third in slice 3).
- Renderer:
  - Status badge component, three variants.
  - Per-row attention flash on `idle → awaiting-input` transitions for
    non-focused sessions (4s yellow border pulse).
  - Title bar aggregator: count of `awaiting-input` sessions.
- Optional desktop notifications via Electron's `Notification` API, off by
  default. This slice **adds the "Desktop notifications on
  awaiting-input" toggle to the settings modal** (the modal itself was
  built in slice 1 with only the Claude binary path). Setting persists
  in `state.json` under `settings.notifyOnAwaitingInput`.

## Calibration

The heuristics will be wrong at first. Plan for that:

- Build a small fixture corpus: capture real Claude Code output for these
  scenarios into text files under `fixtures/`:
  - cold start (splash → prompt),
  - running a long tool call,
  - asking a tool-use confirmation,
  - mid-response model output,
  - completed response,
  - error state.
- Write unit tests for `detectStatus` that load each fixture, simulate
  feeding it in chunks of 1–4 KB, and assert the emitted sequence of
  status transitions.
- Move regex patterns into a small JSON config (`status-patterns.json`)
  loaded at startup. This makes it easy to tune without recompiling.

## Out of scope (later slices)

- Persistence of last-known status across restarts.
- Status history / timeline.
- Smarter detection using Claude Code's structured JSON output mode (it
  exists, but switching to it changes the UX too much for v1 — we'd lose
  the human-readable TUI). Re-evaluate post-v1.
- Bell character handling. Claude Code does emit `\x07` in some
  situations; we could trigger an attention flash on bell too, but defer.

## Implementation notes

- **Stripping ANSI**: keep both a raw buffer (for replay into xterm.js)
  and a stripped buffer (ANSI escapes removed) for pattern matching. A
  small dependency like `strip-ansi` is fine; otherwise a one-line regex.
- **"Latest screen"**: don't match against the entire 256 KB buffer for
  awaiting-input — false positives from earlier in the conversation. Take
  the last ~4 KB or split on form-feed / clear-screen sequences and look
  at the last segment only.
- **Spinner characters**: Claude Code uses braille patterns (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`).
  Their presence in recent output is a strong "working" signal. Pair with
  the "esc to interrupt" string to avoid matching unrelated braille
  content the user might be working with.
- **Debounce mechanics**: keep a per-session `pendingStatus` and
  `pendingSince: number`. On each evaluation, if computed === stored, do
  nothing. If computed !== stored and === pendingStatus and
  `now - pendingSince >= debounceMs`, commit and emit. Otherwise update
  `pendingStatus` / `pendingSince`.
- **Aggregate window title**: compute in the renderer from session state;
  `document.title = ...`. No IPC change.

## Acceptance criteria

1. With a session running a long tool call, the badge shows **working**
   continuously for the duration, then flips to **idle** within ~1
   second of completion.
2. Triggering a Claude Code action that requires user confirmation flips
   the badge to **awaiting input** within ~1 second.
3. The badge does not flicker between **working** and **idle** mid-stream
   for a long response.
4. Creating a brand-new session and immediately submitting a prompt shows
   the badge transition `idle → working → idle` (or
   `idle → working → awaiting-input` if a tool prompt fires) — never
   stuck on idle while the model is clearly responding.
5. The window title reflects how many sessions are awaiting input, live.
6. Unit tests over the fixture corpus pass; updating a pattern in
   `status-patterns.json` and re-running the tests shows the impact
   without a rebuild.
7. With three sessions running, one working, one awaiting, one idle, the
   sidebar visibly conveys all three states at a glance.

## Done when…

A developer can run three sessions, walk away, come back, and from a
glance at the sidebar know which one is asking them a question. That's
the headline feature of the whole app.
