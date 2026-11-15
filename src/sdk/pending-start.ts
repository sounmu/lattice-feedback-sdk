/**
 * A capture starts only after the static text index is ready, and the reporter can close, cancel or reset
 * meanwhile. Each wait takes a token; any of those actions, or a newer wait, makes it stale, so a start the
 * reporter walked away from never turns on selection mode afterwards. Comment and Edit belong to the page they
 * were requested on, so leaving that page drops their start too; a Flow goes on across pages and keeps it.
 */
export function createPendingStartGate() {
  let generation = 0;
  let isWaitingStartPageBound = false;
  return {
    begin(isPageBound = false): () => boolean {
      generation += 1;
      isWaitingStartPageBound = isPageBound;
      const token = generation;
      return () => token === generation;
    },
    invalidate(): void {
      generation += 1;
    },
    pageChanged(): void {
      if (isWaitingStartPageBound) generation += 1;
    },
  };
}
