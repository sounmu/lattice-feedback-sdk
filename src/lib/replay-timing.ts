const ENTRY_PREFIX = 'lattice-replay:';

export type ReplayMark =
  | 'snapshot-start'
  | 'snapshot-headers'
  | 'snapshot-parsed'
  | 'import-start'
  | 'import-end'
  | 'assets-start'
  | 'assets-ready'
  | 'rewrite-start'
  | 'rewrite-end'
  | 'replayer-created'
  | 'first-rebuilt';

interface ReplayMeasure {
  name: string;
  from: ReplayMark;
  to: ReplayMark;
}

const REPLAY_MEASURES: readonly ReplayMeasure[] = [
  { name: 'snapshot-fetch', from: 'snapshot-start', to: 'snapshot-headers' },
  { name: 'snapshot-read', from: 'snapshot-headers', to: 'snapshot-parsed' },
  { name: 'replay-import', from: 'import-start', to: 'import-end' },
  { name: 'assets', from: 'assets-start', to: 'assets-ready' },
  { name: 'rewrite', from: 'rewrite-start', to: 'rewrite-end' },
  { name: 'replayer-create', from: 'rewrite-end', to: 'replayer-created' },
  { name: 'first-rebuild', from: 'replayer-created', to: 'first-rebuilt' },
  { name: 'first-display', from: 'snapshot-start', to: 'first-rebuilt' },
];

export interface ReplayTiming {
  mark(mark: ReplayMark): void;
}

let lastLoadId = 0;

/**
 * The marks of one saved-screen load. Each load names its marks apart, so a load that was left behind or
 * another replay on the page cannot mix into its measures. The measures keep one name per step, and the
 * latest load replaces them once its first page is rebuilt.
 */
export function createReplayTiming(): ReplayTiming {
  lastLoadId += 1;
  const markPrefix = `${ENTRY_PREFIX}${lastLoadId}:`;
  const marked = new Set<ReplayMark>();

  function getMarkName(mark: ReplayMark): string {
    return `${markPrefix}${mark}`;
  }

  function measure() {
    for (const { name, from, to } of REPLAY_MEASURES) {
      if (marked.has(from) && marked.has(to)) {
        performance.clearMeasures(`${ENTRY_PREFIX}${name}`);
        performance.measure(`${ENTRY_PREFIX}${name}`, getMarkName(from), getMarkName(to));
      }
    }
    for (const mark of marked) {
      performance.clearMarks(getMarkName(mark));
    }
  }

  return {
    mark(mark) {
      performance.mark(getMarkName(mark));
      marked.add(mark);
      if (mark === 'first-rebuilt') {
        measure();
      }
    },
  };
}
