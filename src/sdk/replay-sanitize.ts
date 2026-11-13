// The same exclusions as a saved screen apply to everything a Flow recording adds or changes later:
// no script content or handlers, and no hidden input or token meta values (AGENTS.md section 5).
import { RRWEB_FULL_SNAPSHOT_EVENT_TYPE, RRWEB_INCREMENTAL_EVENT_TYPE } from '@/lib/screen-snapshot';
import type { SnapshotAttributes, SnapshotNode } from '@/sdk/snapshot-assets';
import { removeHiddenValues } from '@/sdk/snapshot-hidden-values';
import { removeInlineScripts } from '@/sdk/snapshot-scripts';
import type { ScreenSnapshotEvent } from '@/types/screen-snapshot';

// rrweb IncrementalSource.Mutation.
export const MUTATION_SOURCE = 0;
// rrweb NodeType.Element.
export const ELEMENT_NODE_TYPE = 2;

export interface AttributeChange {
  id: number;
  /** New values by attribute name. Null removes the attribute; a changed style can be an object. */
  attributes: SnapshotAttributes;
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

// The change is checked as the element it produces, its new attributes on top of the recorded ones, so a
// token meta whose content rotates, a value on an input that is or becomes hidden, and a later javascript:
// URL or srcdoc are removed like in the first snapshot. A value that is not text (a removal, a style object)
// only goes when its attribute name is excluded.
function sanitizeAttributeChange(change: AttributeChange, elements: RecordedElements): void {
  const element = elements.get(change.id);
  const attributes: SnapshotAttributes = { ...element?.attributes, ...change.attributes };
  const changedElement: SnapshotNode = { type: ELEMENT_NODE_TYPE, tagName: element?.tagName, attributes };
  removeHiddenValues(changedElement);
  removeInlineScripts(changedElement);
  for (const name of Object.keys(change.attributes)) {
    if (!(name in attributes)) {
      delete change.attributes[name];
    }
  }
  if (element) {
    element.attributes = attributes;
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
