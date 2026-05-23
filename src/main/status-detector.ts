import type { SessionStatus } from '@shared/types';
import rawPatterns from './status-patterns.json';

// Latest-screen window for awaiting/working pattern matching. Looking at the
// full rolling buffer (~256 KB) would false-positive on earlier conversation.
const LATEST_SCREEN_BYTES = 4096;

// Working signal goes stale if no chunks arrive for this long (spinner frozen
// on screen does not mean Claude is still doing something).
const WORKING_FRESHNESS_MS = 2000;

// Debounce windows per the slice 04 spec.
export const DEBOUNCE_MS_ACTIVE = 100; // working / awaiting-input
export const DEBOUNCE_MS_IDLE = 800;

// Minimal ANSI / OSC stripper. Good enough for pattern matching against
// Claude Code's TUI; we do NOT use this on the replay buffer.
const ANSI_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping is the point
  /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\)|[@-Z\\-_])/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

// "Latest screen" — take the tail after the most recent form-feed clear if
// any, else just the last `max` bytes. Used for awaiting-input matching
// (large window, prompt persists across quiet windows).
export function latestScreen(stripped: string, max = LATEST_SCREEN_BYTES): string {
  let s = stripped.length > max ? stripped.slice(-max) : stripped;
  const ff = s.lastIndexOf('\f');
  if (ff >= 0 && ff < s.length - 1) s = s.slice(ff + 1);
  return s;
}

// "Latest line" — what's been written since the most recent \r or \n. The
// spinner-line repaint pattern (`\r⠋ Thinking... (esc to interrupt)`) makes
// this a precise way to ask "is a spinner being painted RIGHT NOW?".
export function latestLine(stripped: string): string {
  const i = Math.max(stripped.lastIndexOf('\r'), stripped.lastIndexOf('\n'));
  return i >= 0 ? stripped.slice(i + 1) : stripped;
}

export interface StatusPatterns {
  awaitingInput: RegExp[];
  spinnerGlyphs: string;
  workingHints: RegExp[];
}

function compilePatterns(raw: typeof rawPatterns): StatusPatterns {
  return {
    awaitingInput: raw.awaitingInputPatterns.map((p) => new RegExp(p, 'i')),
    spinnerGlyphs: raw.spinnerGlyphs,
    workingHints: raw.workingHints.map((p) => new RegExp(p, 'i')),
  };
}

export const defaultPatterns: StatusPatterns = compilePatterns(rawPatterns);

export interface DetectInput {
  stripped: string;
  previous: SessionStatus;
  now: number;
  lastChunkAt: number;
  patterns?: StatusPatterns;
}

// Pure: given a buffer (already ANSI-stripped) and freshness info, what is
// the immediate candidate status? Debounce is applied separately by the
// StatusEngine.
export function detectStatus(input: DetectInput): SessionStatus {
  const patterns = input.patterns ?? defaultPatterns;
  const screen = latestScreen(input.stripped);

  // Priority 1: awaiting input. Patterns survive across quiet windows; if the
  // screen still shows the prompt, the session is still waiting.
  for (const re of patterns.awaitingInput) {
    if (re.test(screen)) return 'awaiting-input';
  }

  // Priority 2: working. Spinner + hint on the most-recently-painted line,
  // AND recent activity. The spinner-line repaint pattern means a fresh
  // spinner sits at the tail of the buffer; once Claude finishes, the line
  // is cleared and new content follows on a new line.
  const fresh = input.now - input.lastChunkAt < WORKING_FRESHNESS_MS;
  if (fresh) {
    const line = latestLine(input.stripped);
    const hasSpinner = [...patterns.spinnerGlyphs].some((g) => line.includes(g));
    if (hasSpinner) {
      for (const re of patterns.workingHints) {
        if (re.test(line)) return 'working';
      }
    }
  }

  return 'idle';
}

export interface EngineResult {
  status: SessionStatus;
  changed: boolean;
}

// Per-session debounce + buffer wrapper. Owns the stripped tail used for
// detection (kept bounded so we never scan more than LATEST_SCREEN_BYTES * 2).
// The raw replay buffer lives separately in session-manager.
export class StatusEngine {
  private status: SessionStatus = 'idle';
  private pendingStatus: SessionStatus | null = null;
  private pendingSince = 0;
  private stripped = '';
  private lastChunkAt = 0;
  private readonly patterns: StatusPatterns;

  constructor(patterns: StatusPatterns = defaultPatterns) {
    this.patterns = patterns;
  }

  get current(): SessionStatus {
    return this.status;
  }

  feed(chunk: string, now: number): EngineResult {
    const next = this.stripped + stripAnsi(chunk);
    // Keep enough tail for latestScreen plus a little slack.
    this.stripped =
      next.length > LATEST_SCREEN_BYTES * 2 ? next.slice(-LATEST_SCREEN_BYTES * 2) : next;
    this.lastChunkAt = now;
    return this.evaluate(now);
  }

  // Periodic re-evaluation so we transition to idle after quiet output even
  // when no new chunks arrive. Cheap to call.
  tick(now: number): EngineResult {
    return this.evaluate(now);
  }

  private evaluate(now: number): EngineResult {
    const candidate = detectStatus({
      stripped: this.stripped,
      previous: this.status,
      now,
      lastChunkAt: this.lastChunkAt,
      patterns: this.patterns,
    });
    return this.applyDebounce(candidate, now);
  }

  private applyDebounce(candidate: SessionStatus, now: number): EngineResult {
    if (candidate === this.status) {
      this.pendingStatus = null;
      return { status: this.status, changed: false };
    }
    if (this.pendingStatus !== candidate) {
      this.pendingStatus = candidate;
      this.pendingSince = now;
      return { status: this.status, changed: false };
    }
    const window = candidate === 'idle' ? DEBOUNCE_MS_IDLE : DEBOUNCE_MS_ACTIVE;
    if (now - this.pendingSince >= window) {
      this.status = candidate;
      this.pendingStatus = null;
      return { status: this.status, changed: true };
    }
    return { status: this.status, changed: false };
  }
}
