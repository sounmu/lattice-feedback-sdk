type TimingPhase = 'auth' | 'db' | 'serialize' | 'gzip';

const SERVER_TIMING_HEADER = 'Server-Timing';

/**
 * Collects how long each phase of one request took. Only a fixed phase name and a duration are ever
 * written, so the header cannot carry a token, a project, or any saved content.
 */
export class ServerTiming {
  private readonly startedAt = performance.now();
  private readonly entries: string[] = [];

  private record(phase: TimingPhase, startedAt: number): void {
    this.entries.push(formatEntry(phase, performance.now() - startedAt));
  }

  async measure<T>(phase: TimingPhase, work: () => T | Promise<T>): Promise<Awaited<T>> {
    const startedAt = performance.now();
    try {
      return await work();
    } finally {
      this.record(phase, startedAt);
    }
  }

  measureSync<T>(phase: TimingPhase, work: () => T): T {
    const startedAt = performance.now();
    try {
      return work();
    } finally {
      this.record(phase, startedAt);
    }
  }

  toHeaders(): Record<typeof SERVER_TIMING_HEADER, string> {
    return { [SERVER_TIMING_HEADER]: [...this.entries, formatEntry('total', performance.now() - this.startedAt)].join(', ') };
  }
}

function formatEntry(name: TimingPhase | 'total', milliseconds: number): string {
  return `${name};dur=${milliseconds.toFixed(1)}`;
}
