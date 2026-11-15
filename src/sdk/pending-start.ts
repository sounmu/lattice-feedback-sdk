/**
 * A capture starts only after the static text index is ready, and the reporter can close, cancel or reset
 * meanwhile. Each wait takes a token; any of those actions, or a newer wait, makes it stale, so a start the
 * reporter walked away from never turns on selection mode afterwards.
 */
export function createPendingStartGate() {
  let generation = 0;
  return {
    begin(): () => boolean {
      generation += 1;
      const token = generation;
      return () => token === generation;
    },
    invalidate(): void {
      generation += 1;
    },
  };
}
