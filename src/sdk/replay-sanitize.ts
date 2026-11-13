// The same exclusions as a saved screen apply to everything a Flow recording adds or changes later:
// no script content or handlers, and no hidden input or token meta values (AGENTS.md section 5).
import { RRWEB_FULL_SNAPSHOT_EVENT_TYPE, RRWEB_INCREMENTAL_EVENT_TYPE } from '@/lib/screen-snapshot';
import type { SnapshotNode } from '@/sdk/snapshot-assets';
import { removeHiddenValues } from '@/sdk/snapshot-hidden-values';
import { removeInlineScripts } from '@/sdk/snapshot-scripts';
import type { ScreenSnapshotEvent } from '@/types/screen-snapshot';

// rrweb IncrementalSource.Mutation.
export const MUTATION_SOURCE = 0;

export interface AttributeChange {
  id: number;
  attributes: Record<string, unknown>;
}

export interface MutationData {
  source: number;
  adds?: { node: SnapshotNode }[];
  attributes?: AttributeChange[];
}

/** Tag and current attributes of each recorded element, by rrweb node id. */
export type RecordedElements = Map<number, Required<Pick<SnapshotNode, 'tagName' | 'attributes'>>>;

export function isMutationEvent(event: ScreenSnapshotEvent): boolean {
  return event.type === RRWEB_INCREMENTAL_EVENT_TYPE && (event.data as MutationData).source === MUTATION_SOURCE;
}

function trackElements(node: SnapshotNode, elements: RecordedElements): void {
  if (node.id !== undefined && node.tagName) {
    elements.set(node.id, { tagName: node.tagName, attributes: { ...node.attributes } });
  }
  node.childNodes?.forEach((child) => trackElements(child, elements));
}

function sanitizeNode(node: SnapshotNode, elements: RecordedElements): void {
  removeInlineScripts(node);
  removeHiddenValues(node);
  trackElements(node, elements);
}

// The change is checked as if it were the element itself with its new attributes, so a token meta whose
// content rotates, a later javascript: URL or srcdoc are removed like in the first snapshot.
function sanitizeAttributeChange(change: AttributeChange, elements: RecordedElements): void {
  const element = elements.get(change.id);
  const merged = { ...element?.attributes, ...change.attributes };
  const probe: SnapshotNode = { tagName: element?.tagName, attributes: merged };
  removeHiddenValues(probe);
  for (const name of Object.keys(change.attributes)) {
    if (!(name in merged)) {
      delete change.attributes[name];
    }
  }
  removeInlineScripts({ attributes: change.attributes });
  if (element) {
    element.attributes = { ...element.attributes, ...change.attributes };
  }
}

/** Cleans the recorded events in place, in order, and returns what is known about each recorded element. */
export function sanitizeReplayEvents(events: readonly ScreenSnapshotEvent[]): RecordedElements {
  const elements: RecordedElements = new Map();
  for (const event of events) {
    if (event.type === RRWEB_FULL_SNAPSHOT_EVENT_TYPE) {
      sanitizeNode((event.data as { node: SnapshotNode }).node, elements);
      continue;
    }
    if (!isMutationEvent(event)) {
      continue;
    }
    const data = event.data as MutationData;
    data.adds?.forEach((add) => sanitizeNode(add.node, elements));
    data.attributes?.forEach((change) => sanitizeAttributeChange(change, elements));
  }
  return elements;
}
