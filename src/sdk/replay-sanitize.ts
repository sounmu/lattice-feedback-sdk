// The same exclusions as a saved screen apply to every node a Flow recording adds later:
// no script content or handlers, and no hidden input or token meta values (AGENTS.md section 5).
import { RRWEB_FULL_SNAPSHOT_EVENT_TYPE, RRWEB_INCREMENTAL_EVENT_TYPE } from '@/lib/screen-snapshot';
import type { SnapshotNode } from '@/sdk/snapshot-assets';
import { removeHiddenValues } from '@/sdk/snapshot-hidden-values';
import { removeInlineScripts } from '@/sdk/snapshot-scripts';
import type { ScreenSnapshotEvent } from '@/types/screen-snapshot';

// rrweb IncrementalSource.Mutation.
const MUTATION_SOURCE = 0;

interface MutationData {
  source: number;
  adds?: { node: SnapshotNode }[];
  attributes?: { id: number; attributes: Record<string, unknown> }[];
}

function collectHiddenInputIds(node: SnapshotNode, ids: Set<number>): void {
  if (node.tagName === 'input' && String(node.attributes?.type ?? '').toLowerCase() === 'hidden' && node.id !== undefined) {
    ids.add(node.id);
  }
  node.childNodes?.forEach((child) => collectHiddenInputIds(child, ids));
}

function sanitizeNode(node: SnapshotNode, hiddenInputIds: Set<number>): void {
  collectHiddenInputIds(node, hiddenInputIds);
  removeInlineScripts(node);
  removeHiddenValues(node);
}

/** Cleans the recorded events in place, in order, so later value changes of a hidden input are dropped too. */
export function sanitizeReplayEvents(events: readonly ScreenSnapshotEvent[]): void {
  const hiddenInputIds = new Set<number>();
  for (const event of events) {
    if (event.type === RRWEB_FULL_SNAPSHOT_EVENT_TYPE) {
      sanitizeNode((event.data as { node: SnapshotNode }).node, hiddenInputIds);
      continue;
    }
    const data = event.data as MutationData;
    if (event.type !== RRWEB_INCREMENTAL_EVENT_TYPE || data.source !== MUTATION_SOURCE) {
      continue;
    }
    data.adds?.forEach((add) => sanitizeNode(add.node, hiddenInputIds));
    for (const change of data.attributes ?? []) {
      if (hiddenInputIds.has(change.id)) {
        delete change.attributes.value;
      }
      for (const name of Object.keys(change.attributes)) {
        if (/^on/i.test(name)) {
          delete change.attributes[name];
        }
      }
    }
  }
}
