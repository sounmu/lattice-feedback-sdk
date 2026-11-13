// Images and styles that appear after the first snapshot of a Flow recording would keep the host service's
// URLs, which the admin origin cannot load. Everything recorded is gathered under one root here, so a single
// extractSnapshotAssets call covers it with shared budgets and reference numbers.
import { RRWEB_FULL_SNAPSHOT_EVENT_TYPE } from '@/lib/screen-snapshot';
import { ELEMENT_NODE_TYPE, isMutationEvent, type MutationData, type RecordedElements } from '@/sdk/replay-sanitize';
import type { SnapshotNode, SnapshotStyleChange } from '@/sdk/snapshot-assets';
import type { ScreenSnapshotEvent } from '@/types/screen-snapshot';

// rrweb NodeType.Document.
const DOCUMENT_NODE_TYPE = 0;
const CSS_URL_MARKER = 'url(';

export interface ReplayAssetRoot {
  root: SnapshotNode;
  /** Writes the rewritten URLs back into style changes rrweb recorded as property dictionaries. */
  applyStyleChanges(): void;
}

/**
 * A root whose children are the full snapshot, every node added later, and every attribute change that sets
 * an image source or an inline style. A change stands in as an element carrying its own attributes object,
 * so the extraction rewrites the recorded change in place. A style recorded as a property dictionary
 * ({ background: 'url(...)' } or [value, priority]) stands in as one inline style per property and is
 * written back by applyStyleChanges once the extraction is done.
 */
export function createReplayAssetRoot(events: readonly ScreenSnapshotEvent[], elements: RecordedElements): ReplayAssetRoot {
  const childNodes: SnapshotNode[] = [];
  const styleWrites: (() => void)[] = [];
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
      const { src, style } = change.attributes;
      if (typeof src === 'string' || typeof style === 'string') {
        childNodes.push({ type: ELEMENT_NODE_TYPE, tagName: elements.get(change.id)?.tagName, attributes: change.attributes });
      }
      if (style && typeof style === 'object') {
        styleWrites.push(...addStyleProperties(style as SnapshotStyleChange, childNodes));
      }
    }
  }
  return {
    root: { type: DOCUMENT_NODE_TYPE, childNodes },
    applyStyleChanges: () => styleWrites.forEach((write) => write()),
  };
}

function addStyleProperties(style: SnapshotStyleChange, childNodes: SnapshotNode[]): (() => void)[] {
  return Object.entries(style).flatMap(([property, value]) => {
    if (value === false) {
      return [];
    }
    const [text, priority] = typeof value === 'string' ? [value, undefined] : value;
    if (!text.includes(CSS_URL_MARKER)) {
      return [];
    }
    const stand: SnapshotNode = { type: ELEMENT_NODE_TYPE, attributes: { style: text } };
    childNodes.push(stand);
    return [() => {
      const rewritten = String(stand.attributes?.style);
      style[property] = priority === undefined ? rewritten : [rewritten, priority];
    }];
  });
}
