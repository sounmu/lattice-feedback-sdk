// Images and styles that appear after the first snapshot of a Flow recording would keep the host service's
// URLs, which the admin origin cannot load. Everything recorded is gathered under one root here, so a single
// extractSnapshotAssets call covers it with shared budgets and reference numbers.
import { RRWEB_FULL_SNAPSHOT_EVENT_TYPE } from '@/lib/screen-snapshot';
import { ELEMENT_NODE_TYPE, isMutationEvent, type MutationData, type RecordedElements } from '@/sdk/replay-sanitize';
import { parseSrcset, type SnapshotAttributes, type SnapshotNode, type SnapshotStyleChange } from '@/sdk/snapshot-assets';
import type { ScreenSnapshotEvent } from '@/types/screen-snapshot';

// rrweb NodeType.Document.
const DOCUMENT_NODE_TYPE = 0;
const CSS_URL_MARKER = 'url(';
const IMAGE_TAG_NAME = 'img';
// Elements whose srcset lists image files: <img> and <source> inside <picture>.
const SRCSET_TAG_NAMES: ReadonlySet<string> = new Set([IMAGE_TAG_NAME, 'source']);

export interface ReplayAssetRoot {
  root: SnapshotNode;
  /** Writes the rewritten URLs back into changes that are not rewritten in place: style dictionaries and srcset lists. */
  applyRewrites(): void;
}

/**
 * A root whose children are the full snapshot, every node added later, and every attribute change that sets
 * an image source or an inline style. A change stands in as an element carrying its own attributes object,
 * so the extraction rewrites the recorded change in place. Two kinds of change stand in piece by piece and
 * are written back by applyRewrites once the extraction is done: a style recorded as a property dictionary
 * ({ background: 'url(...)' } or [value, priority]), and a changed srcset.
 */
export function createReplayAssetRoot(events: readonly ScreenSnapshotEvent[], elements: RecordedElements): ReplayAssetRoot {
  const childNodes: SnapshotNode[] = [];
  const rewrites: (() => void)[] = [];
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
      const { src, srcset, style } = change.attributes;
      const tagName = elements.get(change.id)?.tagName;
      const hasSrcset = typeof srcset === 'string' && tagName !== undefined && SRCSET_TAG_NAMES.has(tagName);
      if (hasSrcset) {
        rewrites.push(addSrcsetCandidates(change.attributes, tagName === IMAGE_TAG_NAME, childNodes));
      }
      if (typeof style === 'string' || (typeof src === 'string' && !hasSrcset)) {
        // With a srcset the sources are handled above, so the stand-in is read for its style only.
        childNodes.push({ type: ELEMENT_NODE_TYPE, tagName: hasSrcset ? undefined : tagName, attributes: change.attributes });
      }
      if (style && typeof style === 'object') {
        rewrites.push(...addStyleProperties(style as SnapshotStyleChange, childNodes));
      }
    }
  }
  return {
    root: { type: DOCUMENT_NODE_TYPE, childNodes },
    applyRewrites: () => rewrites.forEach((rewrite) => rewrite()),
  };
}

// Which candidate the browser shows after a later srcset change is not known when the change is recorded
// (the new file may still be loading), so every candidate is saved and the viewer's browser chooses among
// them. Only the first state of an image keeps exactly the file the reporter saw.
function addSrcsetCandidates(attributes: SnapshotAttributes, hasImageSource: boolean, childNodes: SnapshotNode[]): () => void {
  const addImage = (url: string): SnapshotNode => {
    const stand: SnapshotNode = { type: ELEMENT_NODE_TYPE, tagName: IMAGE_TAG_NAME, attributes: { src: url } };
    childNodes.push(stand);
    return stand;
  };
  const candidates = parseSrcset(String(attributes.srcset)).map(({ url, descriptor }) => ({ stand: addImage(url), descriptor }));
  const source = hasImageSource && typeof attributes.src === 'string' ? addImage(attributes.src) : null;
  return () => {
    attributes.srcset = candidates
      .map(({ stand, descriptor }) => [String(stand.attributes?.src), descriptor].filter((part) => part !== '').join(' '))
      .join(', ');
    if (source) {
      attributes.src = String(source.attributes?.src);
    }
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
