import { markReplay } from '@/lib/replay-timing';

type ReplayModule = typeof import('@rrweb/replay');

let pending: Promise<ReplayModule> | null = null;

// Loaded in the browser only: rrweb expects a DOM when its module is evaluated.
export function loadReplayModule(): Promise<ReplayModule> {
  if (!pending) {
    markReplay('import-start');
    pending = import('@rrweb/replay').then(
      (loaded) => {
        markReplay('import-end');
        return loaded;
      },
      (error: unknown) => {
        pending = null;
        throw error;
      },
    );
  }
  return pending;
}
