// Images and styles that appear after the first snapshot of a Flow recording would keep the host service's
// URLs, which the admin origin cannot load. Everything recorded is gathered under one root here, so a single
// extractSnapshotAssets call covers it with shared budgets and reference numbers.
import { RRWEB_FULL_SNAPSHOT_EVENT_TYPE } from '@/lib/screen-snapshot';
import { ELEMENT_NODE_TYPE, isMutationEvent, type MutationData, type RecordedElements } from '@/sdk/replay-sanitize';
import type { SnapshotNode } from '@/sdk/snapshot-assets';
import type { ScreenSnapshotEvent } from '@/types/screen-snapshot';

// rrweb NodeType.Document.
const DOCUMENT_NODE_TYPE = 0;

/**
 * A root whose children are the full snapshot, every node added later, and every attribute change that sets
 * an image source or an inline style. A change stands in as an element carrying its own attributes object,
 * so the extraction rewrites the recorded change in place.
 */
export function createReplayAssetRoot(events: readonly ScreenSnapshotEvent[], elements: RecordedElements): SnapshotNode {
  const childNodes: SnapshotNode[] = [];
  for (const event of events) {
    if (event.type === RRWEB_FULL_SNAPSHOT_EVENT_TYPE) {
      childNodes.push((event.data as { node: SnapshotNode }).node);
      continue;
    }
    if (!isMutationEvent(event)) {
      continue;
    }
    const data = event.data as MutationData;
    data.adds?.forEach((add) => childNodes.push(add.node));
    for (const change of data.attributes ?? []) {
      if (typeof change.attributes.src === 'string' || typeof change.attributes.style === 'string') {
        childNodes.push({ type: ELEMENT_NODE_TYPE, tagName: elements.get(change.id)?.tagName, attributes: change.attributes });
      }
    }
  }
  return { type: DOCUMENT_NODE_TYPE, childNodes };
}
