// Dependency-free helpers for looking at a saved screen: where its replay can be stepped, how large the
// page was at a position of it, and which locally kept captures still belong to the draft.
import {
  RRWEB_FULL_SNAPSHOT_EVENT_TYPE,
  RRWEB_INCREMENTAL_EVENT_TYPE,
  RRWEB_META_EVENT_TYPE,
} from '@/lib/screen-snapshot';
import type { ScreenSnapshotEvent, ScreenSnapshotPage, ScreenSnapshotSummary } from '@/types/screen-snapshot';

export type ReplayStepKind = 'start' | 'screen' | 'click' | 'input' | 'scroll';

export interface ReplayStep {
  kind: ReplayStepKind;
  /** Replay position that shows the step's effect: just after its event. */
  atMs: number;
}

export type ReplayViewport = Pick<ScreenSnapshotPage, 'viewportWidth' | 'viewportHeight'>;

// rrweb IncrementalSource values, and the MouseInteractions values of a click and a double click.
const MOUSE_INTERACTION_SOURCE = 2;
const SCROLL_SOURCE = 3;
const VIEWPORT_RESIZE_SOURCE = 4;
const INPUT_SOURCE = 5;
const CLICK_INTERACTION = 2;
const DOUBLE_CLICK_INTERACTION = 4;
// Typing and scrolling arrive as runs of events; a run is one step, placed at its last event.
const RUN_GAP_MS = 500;
const RUN_KINDS: readonly ReplayStepKind[] = ['input', 'scroll'];

function getEventData(event: ScreenSnapshotEvent): Record<string, unknown> {
  return typeof event.data === 'object' && event.data !== null ? (event.data as Record<string, unknown>) : {};
}

function findStepKind(event: ScreenSnapshotEvent): ReplayStepKind | null {
  if (event.type === RRWEB_FULL_SNAPSHOT_EVENT_TYPE) {
    return 'screen';
  }
  if (event.type !== RRWEB_INCREMENTAL_EVENT_TYPE) {
    return null;
  }
  const { source, type } = getEventData(event);
  switch (source) {
    case MOUSE_INTERACTION_SOURCE:
      return type === CLICK_INTERACTION || type === DOUBLE_CLICK_INTERACTION ? 'click' : null;
    case SCROLL_SOURCE:
      return 'scroll';
    case INPUT_SOURCE:
      return 'input';
    default:
      return null;
  }
}

/**
 * The positions of a replay worth stopping at, in order: its start, each later full snapshot (a new
 * page or a reload), each click, and each run of typing or scrolling. Positions strictly increase and
 * never pass the end of the replay.
 */
export function findReplaySteps(events: readonly ScreenSnapshotEvent[]): ReplayStep[] {
  const steps: ReplayStep[] = [{ kind: 'start', atMs: 0 }];
  if (events.length === 0) {
    return steps;
  }
  const startTime = events[0].timestamp;
  const totalMs = events[events.length - 1].timestamp - startTime;
  const actions: { kind: ReplayStepKind; startMs: number; endMs: number }[] = [];
  let hasStartScreen = false;
  for (const event of events) {
    const kind = findStepKind(event);
    if (!kind) {
      continue;
    }
    // The first full snapshot is the start itself, not a change of screen.
    if (kind === 'screen' && !hasStartScreen) {
      hasStartScreen = true;
      continue;
    }
    const atMs = event.timestamp - startTime;
    const last = actions.at(-1);
    if (last && RUN_KINDS.includes(kind) && last.kind === kind && atMs - last.endMs <= RUN_GAP_MS) {
      last.endMs = atMs;
    } else {
      actions.push({ kind, startMs: atMs, endMs: atMs });
    }
  }
  // A step shows the changes after the action, stopping before the next action starts.
  // Seeking just to the click itself misses the DOM mutation its handler produces.
  actions.forEach((action, index) => {
    const next = actions[index + 1];
    const atMs = next ? Math.min(totalMs, next.startMs - 1) : totalMs;
    if (atMs > steps[steps.length - 1].atMs) {
      steps.push({ kind: action.kind, atMs });
    }
  });
  return steps;
}

/** The step a replay position belongs to: the last one at or before it. */
export function getCurrentStepIndex(steps: readonly ReplayStep[], currentMs: number): number {
  let index = 0;
  steps.forEach((step, position) => {
    if (step.atMs <= currentMs) {
      index = position;
    }
  });
  return index;
}

/** The step to move to from a replay position, or null at either end. */
export function findAdjacentStep(
  steps: readonly ReplayStep[],
  currentMs: number,
  direction: 'previous' | 'next',
): ReplayStep | null {
  const index = getCurrentStepIndex(steps, currentMs);
  if (direction === 'next') {
    return steps[index + 1] ?? null;
  }
  // Partway through a step, "previous" first returns to that step.
  if (currentMs > steps[index].atMs) {
    return steps[index];
  }
  return steps[index - 1] ?? null;
}

function isSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * The page size at a position of a replay. A recorded Flow can cross pages and window sizes; each is
 * announced by a Meta or viewport-resize event, and the last one up to the position applies.
 */
export function getViewportAt(
  events: readonly ScreenSnapshotEvent[],
  currentMs: number,
  page: ReplayViewport,
): ReplayViewport {
  let viewport: ReplayViewport = { viewportWidth: page.viewportWidth, viewportHeight: page.viewportHeight };
  const startTime = events[0]?.timestamp ?? 0;
  for (const event of events) {
    if (event.timestamp - startTime > currentMs) {
      break;
    }
    const { source, width, height } = getEventData(event);
    const isResize = event.type === RRWEB_META_EVENT_TYPE ||
      (event.type === RRWEB_INCREMENTAL_EVENT_TYPE && source === VIEWPORT_RESIZE_SOURCE);
    if (isResize && isSize(width) && isSize(height)) {
      viewport = { viewportWidth: width, viewportHeight: height };
    }
  }
  return viewport;
}

/** The locally kept captures of the screens still in the draft; a removed or replaced screen lets go of its files. */
export function keepListedCaptures<TCapture>(
  captures: ReadonlyMap<string, TCapture>,
  snapshots: readonly Pick<ScreenSnapshotSummary, 'id'>[],
): Map<string, TCapture> {
  const listed = new Set(snapshots.map((snapshot) => snapshot.id));
  return new Map([...captures].filter(([id]) => listed.has(id)));
}
