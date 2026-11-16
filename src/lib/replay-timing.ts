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

function getEntryName(name: string): string {
  return `${ENTRY_PREFIX}${name}`;
}

function hasMark(mark: ReplayMark): boolean {
  return performance.getEntriesByName(getEntryName(mark), 'mark').length > 0;
}

export function markReplay(mark: ReplayMark): void {
  performance.mark(getEntryName(mark));
}

export function resetReplayTiming(): void {
  for (const { name, from, to } of REPLAY_MEASURES) {
    performance.clearMeasures(getEntryName(name));
    performance.clearMarks(getEntryName(from));
    performance.clearMarks(getEntryName(to));
  }
}

export function measureReplay(): void {
  for (const { name, from, to } of REPLAY_MEASURES) {
    if (hasMark(from) && hasMark(to)) {
      performance.measure(getEntryName(name), getEntryName(from), getEntryName(to));
    }
  }
}
