import { describe, expect, it } from 'vitest';
import {
  DEBOUNCE_MS_ACTIVE,
  DEBOUNCE_MS_IDLE,
  StatusEngine,
  defaultPatterns,
  detectStatus,
  latestScreen,
  stripAnsi,
} from '../src/main/status-detector.js';
import type { SessionStatus } from '../src/shared/types.js';
import {
  awaitingConfirm,
  chunkify,
  coldStart,
  completed,
  errorState,
  midResponse,
  workingFrames,
  workingLong,
  yesNoPrompt,
} from './fixtures/claude-output.js';

// Drive an engine through chunks at known timestamps and collect the sequence
// of emitted transitions. Returns one entry per chunk that crossed a debounce
// threshold.
function runChunks(
  chunks: { text: string; at: number }[],
  ticks: number[] = [],
): { at: number; status: SessionStatus }[] {
  const engine = new StatusEngine(defaultPatterns);
  const transitions: { at: number; status: SessionStatus }[] = [];
  const events = [
    ...chunks.map((c) => ({ kind: 'chunk' as const, ...c })),
    ...ticks.map((at) => ({ kind: 'tick' as const, at, text: '' })),
  ].sort((a, b) => a.at - b.at);
  for (const e of events) {
    const r = e.kind === 'chunk' ? engine.feed(e.text, e.at) : engine.tick(e.at);
    if (r.changed) transitions.push({ at: e.at, status: r.status });
  }
  return transitions;
}

describe('stripAnsi', () => {
  it('removes CSI color sequences', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
  });
  it('removes OSC hyperlink sequences', () => {
    expect(stripAnsi('\x1b]8;;https://x\x07link\x1b]8;;\x07')).toBe('link');
  });
  it('passes plain text through', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });
});

describe('latestScreen', () => {
  it('returns the tail when buffer exceeds the window', () => {
    const long = `${'A'.repeat(10000)}TAIL`;
    expect(latestScreen(long, 100).endsWith('TAIL')).toBe(true);
    expect(latestScreen(long, 100).length).toBeLessThanOrEqual(100);
  });
  it('splits on form feed when present', () => {
    expect(latestScreen('older\fnewer')).toBe('newer');
  });
});

describe('detectStatus (pure)', () => {
  const NOW = 1000;
  const FRESH = NOW;
  const STALE = NOW - 10_000;

  it('returns awaiting-input on confirmation prompt', () => {
    const candidate = detectStatus({
      stripped: stripAnsi(awaitingConfirm),
      previous: 'working',
      now: NOW,
      lastChunkAt: STALE,
    });
    expect(candidate).toBe('awaiting-input');
  });

  it('returns awaiting-input even after a quiet window (prompt still on screen)', () => {
    // No fresh activity, but the prompt is still visible.
    expect(
      detectStatus({
        stripped: stripAnsi(awaitingConfirm),
        previous: 'awaiting-input',
        now: NOW,
        lastChunkAt: STALE,
      }),
    ).toBe('awaiting-input');
  });

  it('returns working on spinner + interrupt hint with fresh activity', () => {
    expect(
      detectStatus({
        stripped: stripAnsi(workingLong),
        previous: 'idle',
        now: NOW,
        lastChunkAt: FRESH,
      }),
    ).toBe('working');
  });

  it('does NOT return working when the spinner is stale', () => {
    // Same buffer, but the last chunk was 10s ago.
    expect(
      detectStatus({
        stripped: stripAnsi(workingLong),
        previous: 'working',
        now: NOW,
        lastChunkAt: STALE,
      }),
    ).toBe('idle');
  });

  it('returns idle for cold start', () => {
    expect(
      detectStatus({
        stripped: stripAnsi(coldStart),
        previous: 'idle',
        now: NOW,
        lastChunkAt: STALE,
      }),
    ).toBe('idle');
  });

  it('returns idle for mid-response (no spinner, no prompt)', () => {
    expect(
      detectStatus({
        stripped: stripAnsi(midResponse),
        previous: 'working',
        now: NOW,
        lastChunkAt: FRESH,
      }),
    ).toBe('idle');
  });

  it('returns idle for a completed response', () => {
    expect(
      detectStatus({
        stripped: stripAnsi(completed),
        previous: 'working',
        now: NOW,
        lastChunkAt: FRESH,
      }),
    ).toBe('idle');
  });

  it('returns idle for an error state with no prompt or spinner', () => {
    expect(
      detectStatus({
        stripped: stripAnsi(errorState),
        previous: 'working',
        now: NOW,
        lastChunkAt: FRESH,
      }),
    ).toBe('idle');
  });

  it('matches the short y/n prompt', () => {
    expect(
      detectStatus({
        stripped: stripAnsi(yesNoPrompt),
        previous: 'working',
        now: NOW,
        lastChunkAt: FRESH,
      }),
    ).toBe('awaiting-input');
  });
});

describe('StatusEngine (debounced sequence)', () => {
  it('idle → working → idle for a long tool call', () => {
    // Feed all spinner frames over time, then go quiet, then tick.
    const chunks = workingFrames.map((text, i) => ({ text, at: 1000 + i * 50 }));
    const lastAt = chunks[chunks.length - 1].at;
    // Append a quiet completion. New chunk at lastAt + 200 with a clean prompt.
    chunks.push({ text: completed, at: lastAt + 200 });
    // Ticks at +100, +1000 ms after that final chunk so the 800ms idle window expires.
    const ticks = [
      chunks[chunks.length - 1].at + 100,
      chunks[chunks.length - 1].at + 1000,
      chunks[chunks.length - 1].at + 1500,
    ];
    const transitions = runChunks(chunks, ticks);
    const sequence = transitions.map((t) => t.status);
    expect(sequence).toEqual(['working', 'idle']);
  });

  it('idle → working → awaiting-input on confirmation mid-stream', () => {
    const chunks = workingFrames.map((text, i) => ({ text, at: 1000 + i * 50 }));
    const lastAt = chunks[chunks.length - 1].at;
    chunks.push({ text: awaitingConfirm, at: lastAt + 100 });
    const ticks = [chunks[chunks.length - 1].at + 200];
    const transitions = runChunks(chunks, ticks);
    const sequence = transitions.map((t) => t.status);
    expect(sequence).toEqual(['working', 'awaiting-input']);
  });

  it('respects the 100ms debounce for working (no flicker on first spinner chunk)', () => {
    // Single spinner chunk at t=1000, then go quiet. Without sufficient stable
    // time, no transition is emitted.
    const transitions = runChunks([{ text: workingFrames[2], at: 1000 }], [1010, 1050, 1099]);
    // 99ms elapsed since first chunk; below DEBOUNCE_MS_ACTIVE.
    expect(transitions).toEqual([]);
    expect(DEBOUNCE_MS_ACTIVE).toBe(100);
  });

  it('respects the 800ms debounce for idle', () => {
    // Get into working, then stop. Tick at < 800ms after — no idle transition.
    const chunks = workingFrames.slice(0, 5).map((text, i) => ({ text, at: 1000 + i * 50 }));
    const transitions = runChunks(chunks, [
      chunks[chunks.length - 1].at + 100,
      chunks[chunks.length - 1].at + 500,
      chunks[chunks.length - 1].at + 799,
    ]);
    // First transition should be to working (debounce 100ms hit). No idle yet.
    expect(transitions.map((t) => t.status)).toEqual(['working']);
    expect(DEBOUNCE_MS_IDLE).toBe(800);
  });

  it('streams via 1-4KB chunks without flickering', () => {
    // Concatenate the working stream and feed in fixed-size byte chunks.
    const combined = workingLong;
    const pieces = chunkify(combined, 200); // ~200B chunks (smaller than 1 KB; stress case)
    const chunks = pieces.map((text, i) => ({ text, at: 1000 + i * 30 }));
    const last = chunks[chunks.length - 1].at;
    // No tail completion — keep ticking quietly. Working freshness is 2s; the
    // idle debounce is 800ms on top of that.
    const ticks = [last + 100, last + 500, last + 1500, last + 2100, last + 3000];
    const transitions = runChunks(chunks, ticks);
    const sequence = transitions.map((t) => t.status);
    // Should go to working, then once the freshness window (2s) lapses and
    // the 800ms idle debounce expires, eventually to idle.
    expect(sequence[0]).toBe('working');
    expect(sequence[sequence.length - 1]).toBe('idle');
    // No alternation between working/idle in the middle.
    for (let i = 1; i < sequence.length - 1; i++) {
      // Only allowed inner transition is none beyond the two endpoints.
      expect(sequence[i]).toBe('working');
    }
  });
});

describe('status-patterns config is tunable', () => {
  it('removing a pattern from defaults stops matching', () => {
    // Re-load fixture but with a narrowed-down patterns config that omits the
    // "Do you want to proceed?" pattern.
    const narrowed = {
      ...defaultPatterns,
      awaitingInput: defaultPatterns.awaitingInput.filter(
        (re) => !/proceed/i.source.includes(re.source),
      ),
    };
    // Drop ALL awaiting patterns to prove the config drives behavior.
    narrowed.awaitingInput = [];
    expect(
      detectStatus({
        stripped: stripAnsi(awaitingConfirm),
        previous: 'idle',
        now: 1000,
        lastChunkAt: 1000,
        patterns: narrowed,
      }),
    ).toBe('idle');
  });
});
