// Hand-rolled approximations of Claude Code TUI output for status-detector
// calibration. Each export captures one scenario; chunks may include CSI
// escape sequences and the braille spinner glyphs the real TUI emits.

const ESC = '\x1b';
const CSI = `${ESC}[`;
const CLEAR = `${CSI}2J${CSI}H`;
const DIM = `${CSI}2m`;
const RESET = `${CSI}0m`;

// 1. Cold start: splash screen, no prompt activity.
export const coldStart = `${CLEAR}\n Welcome to Claude Code!\n\n${CSI}36m╭──────────────────────────────────────────╮${RESET}\n${CSI}36m│${RESET} Claude Code v1.0.0                          ${CSI}36m│${RESET}\n${CSI}36m│${RESET} /help for help, /status for your setup      ${CSI}36m│${RESET}\n${CSI}36m╰──────────────────────────────────────────╯${RESET}\n\n${DIM}> Try "fix lint errors" or "what does this file do?"${RESET}\n\n${DIM}╭──────────────────────────────────────────╮${RESET}\n${DIM}│ >                                            │${RESET}\n${DIM}╰──────────────────────────────────────────╯${RESET}\n${DIM}  ? for shortcuts${RESET}\n`;

// 2. Long tool call in progress: spinner + interrupt hint.
//    A real TUI repaints the same line many times; we simulate that with
//    multiple spinner frames so any single 1-4 KB chunk will see one.
export const workingFrames: string[] = [
  `${CSI}36m●${RESET} Reading src/index.ts\n`,
  `${CSI}36m●${RESET} Reading src/main.ts\n\n`,
  `${CSI}33m⠋${RESET} Thinking... (esc to interrupt)\n`,
  `\r${CSI}33m⠙${RESET} Thinking... (esc to interrupt)`,
  `\r${CSI}33m⠹${RESET} Thinking... (esc to interrupt)`,
  `\r${CSI}33m⠸${RESET} Thinking... (esc to interrupt)`,
  `\r${CSI}33m⠼${RESET} Thinking... (esc to interrupt)`,
  `\r${CSI}33m⠴${RESET} Searching codebase... (esc to interrupt)`,
  `\r${CSI}33m⠦${RESET} Searching codebase... (esc to interrupt)`,
  `\r${CSI}33m⠧${RESET} Searching codebase... (esc to interrupt)`,
];
export const workingLong = workingFrames.join('');

// 3. Awaiting confirmation: numbered choice prompt.
export const awaitingConfirm = `${CLEAR}I'd like to edit src/index.ts:\n\n${CSI}32m+ console.log("hello");${RESET}\n\nDo you want to proceed?\n${CSI}1m❯ 1. Yes${RESET}\n  2. Yes, and don't ask again this session\n  3. No, and tell Claude what to do differently\n`;

// 4. Mid-response: text streaming, no spinner, no prompt.
export const midResponse =
  'Here is the answer:\n\n' +
  'The function in question takes three arguments and returns the\n' +
  'composition of two of them. It does not throw. There is no observable\n' +
  'side effect other than the return value.\n\n' +
  'Some examples:\n' +
  '  - foo(1, 2, 3) -> 5\n' +
  '  - foo(0, 0, 0) -> 0\n';

// 5. Completed response: assistant turn ended, prompt box visible again,
//    no spinner, no confirm.
export const completed = `Done.\n\n${DIM}╭──────────────────────────────────────────╮${RESET}\n${DIM}│ >                                            │${RESET}\n${DIM}╰──────────────────────────────────────────╯${RESET}\n${DIM}  ? for shortcuts${RESET}\n`;

// 6. Error state: a red-tinted error message but no confirmation prompt and
//    no spinner. Should resolve to idle.
export const errorState = `${CSI}31mError:${RESET} command failed with exit code 1\nstderr: ENOENT: no such file or directory\n\n${DIM}╭──────────────────────────────────────────╮${RESET}\n${DIM}│ >                                            │${RESET}\n${DIM}╰──────────────────────────────────────────╯${RESET}\n`;

// 7. y/n short prompt — a smaller confirmation pattern.
export const yesNoPrompt = 'Overwrite existing file? (y/n) ';

// Helper: split a string into approximately-equal chunks for streaming sims.
export function chunkify(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}
