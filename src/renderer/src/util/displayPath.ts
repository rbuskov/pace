// Best-effort `$HOME → ~` collapse for display. We learn $HOME from a hint
// embedded in process.env.PACE_HOME at preload time, falling back to a leading
// /Users/<name> heuristic for macOS. For v1 we keep this simple — the renderer
// can't read process.env directly.

export function displayPath(absolutePath: string, home?: string | null): string {
  if (!absolutePath) return absolutePath;
  if (home && absolutePath === home) return '~';
  if (home && absolutePath.startsWith(`${home}/`)) {
    return `~${absolutePath.slice(home.length)}`;
  }
  return absolutePath;
}
