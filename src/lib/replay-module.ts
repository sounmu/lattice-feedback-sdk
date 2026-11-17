type ReplayModule = typeof import('@rrweb/replay');

let pending: Promise<ReplayModule> | null = null;

// Loaded in the browser only: rrweb expects a DOM when its module is evaluated.
export function loadReplayModule(): Promise<ReplayModule> {
  if (!pending) {
    pending = import('@rrweb/replay').catch((error: unknown) => {
      pending = null;
      throw error;
    });
  }
  return pending;
}
