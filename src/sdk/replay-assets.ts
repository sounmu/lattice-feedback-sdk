// Images and styles that appear after the first snapshot of a Flow recording would keep the host service's
// URLs, which the admin origin cannot load. Everything recorded is gathered under one root here, so a single
// extractSnapshotAssets call covers it with shared budgets and reference numbers.
import { RRWEB_FULL_SNAPSHOT_EVENT_TYPE, RRWEB_INCREMENTAL_EVENT_TYPE, RRWEB_META_EVENT_TYPE } from '@/lib/screen-snapshot';
import type { ReplaySegment } from '@/sdk/flow-replay-segment';
import { ELEMENT_NODE_TYPE, isMutationEvent, sanitizeReplayEvents, type MutationData, type RecordedElements } from '@/sdk/replay-sanitize';
import { parseSrcset, resolveCssUrls, type SnapshotAttributes, type SnapshotNode, type SnapshotStyleChange } from '@/sdk/snapshot-assets';
import type { ScreenSnapshotEvent } from '@/types/screen-snapshot';

// rrweb NodeType.Document and NodeType.Text.
const DOCUMENT_NODE_TYPE = 0;
const TEXT_NODE_TYPE = 3;
// rrweb IncrementalSource.StyleSheetRule, StyleDeclaration and AdoptedStyleSheet: CSS changed through script.
const STYLE_SHEET_SOURCES: ReadonlySet<number> = new Set([8, 13, 15]);
const CSS_URL_MARKER = 'url(';
const IMAGE_TAG_NAME = 'img';
const STYLE_TAG_NAME = 'style';
// Elements whose srcset lists image files: <img> and <source> inside <picture>.
const SRCSET_TAG_NAMES: ReadonlySet<string> = new Set([IMAGE_TAG_NAME, 'source']);

type TextNode = SnapshotNode & { textContent?: string; childNodes?: TextNode[] };

/** Where CSS text recorded after the first snapshot goes: its URLs are relative to the document it was in. */
interface CssTextTarget {
  baseUrl: string | undefined;
  childNodes: SnapshotNode[];
}

interface StyleRule {
  rule: string;
}

/** The CSS text a stylesheet change can carry, whichever of the three sources recorded it. */
interface StyleSheetChange {
  source: number;
  /** rrweb node id of the element that owns the stylesheet; absent for a stylesheet made through script. */
  id?: number;
  adds?: StyleRule[];
  replace?: string;
  replaceSync?: string;
  set?: { value: string | null };
  styles?: { rules: StyleRule[] }[];
}

export interface ReplayAssetRoot {
  root: SnapshotNode;
  /** Writes the rewritten URLs back into changes that are not rewritten in place: style dictionaries and srcset lists. */
  applyRewrites(): void;
}

/**
 * A root whose children are the full snapshot, every node added later, every attribute change that sets
 * an image source or an inline style, and every piece of CSS text changed later: rules and declarations
 * set through script, and the text of <style> elements. A change stands in as an element carrying its own attributes object,
 * so the extraction rewrites the recorded change in place. Two kinds of change stand in piece by piece and
 * are written back by applyRewrites once the extraction is done: a style recorded as a property dictionary
 * ({ background: 'url(...)' } or [value, priority]), and a changed srcset. Changed CSS text is written back too.
 */
export function createReplayAssetRoot(events: readonly ScreenSnapshotEvent[], elements: RecordedElements): ReplayAssetRoot {
  const childNodes: SnapshotNode[] = [];
  const rewrites: (() => void)[] = [];
  // Text nodes of <style> elements, whose text is CSS.
  const styleTextIds = new Set<number>();
  const target: CssTextTarget = { baseUrl: undefined, childNodes };
  for (const event of events) {
    if (event.type === RRWEB_META_EVENT_TYPE) {
      const { href } = event.data as { href?: unknown };
      target.baseUrl = typeof href === 'string' ? href : undefined;
      continue;
    }
    if (event.type === RRWEB_FULL_SNAPSHOT_EVENT_TYPE) {
      const { node } = event.data as { node: SnapshotNode };
      childNodes.push(node);
      rewrites.push(...addStyleTexts(node, undefined, styleTextIds, target));
      continue;
    }
    if (isStyleSheetChange(event)) {
      rewrites.push(...addStyleSheetChange(event.data as StyleSheetChange, target));
      continue;
    }
    if (!isMutationEvent(event)) {
      continue;
    }
    const data = event.data as MutationData;
    for (const add of data.adds ?? []) {
      childNodes.push(add.node);
      const parentTagName = add.parentId === undefined ? undefined : elements.get(add.parentId)?.tagName;
      rewrites.push(...addStyleTexts(add.node, parentTagName, styleTextIds, target));
    }
    for (const text of data.texts ?? []) {
      if (styleTextIds.has(text.id) && typeof text.value === 'string') {
        rewrites.push(...addCssText(text.value, target, (rewritten) => {
          text.value = rewritten;
        }));
      }
    }
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

// CSS text kept outside an attribute stands in as a stylesheet of its own, so its fonts and images are
// saved, or recorded as missing, like those of any other stylesheet. URLs that are still relative
// here are resolved against the document; those of a rule set in a linked stylesheet were resolved against
// that stylesheet when the rule was recorded.
function addCssText(cssText: string, { baseUrl, childNodes }: CssTextTarget, write: (rewritten: string) => void): (() => void)[] {
  if (!cssText.includes(CSS_URL_MARKER)) {
    return [];
  }
  const resolved = baseUrl === undefined ? cssText : resolveCssUrls(cssText, baseUrl);
  const stand: SnapshotNode = { type: ELEMENT_NODE_TYPE, attributes: { _cssText: resolved } };
  childNodes.push(stand);
  return [() => write(String(stand.attributes?._cssText))];
}

function addStyleTexts(
  node: TextNode,
  parentTagName: string | undefined,
  styleTextIds: Set<number>,
  target: CssTextTarget,
): (() => void)[] {
  const rewrites: (() => void)[] = [];
  if (node.type === TEXT_NODE_TYPE && parentTagName === STYLE_TAG_NAME) {
    if (node.id !== undefined) {
      styleTextIds.add(node.id);
    }
    if (typeof node.textContent === 'string') {
      rewrites.push(...addCssText(node.textContent, target, (rewritten) => {
        node.textContent = rewritten;
      }));
    }
  }
  for (const child of node.childNodes ?? []) {
    rewrites.push(...addStyleTexts(child, node.tagName, styleTextIds, target));
  }
  return rewrites;
}

interface CssTextSlot {
  cssText: string;
  write(rewritten: string): void;
}

// Every place a stylesheet change keeps CSS text, whichever source recorded it.
function findCssTextSlots(change: StyleSheetChange): CssTextSlot[] {
  const rules = [...(change.adds ?? []), ...(change.styles ?? []).flatMap((style) => style.rules)];
  const slots: CssTextSlot[] = rules.map((rule) => ({
    cssText: rule.rule,
    write: (rewritten) => {
      rule.rule = rewritten;
    },
  }));
  for (const key of ['replace', 'replaceSync'] as const) {
    const cssText = change[key];
    if (typeof cssText === 'string') {
      slots.push({
        cssText,
        write: (rewritten) => {
          change[key] = rewritten;
        },
      });
    }
  }
  const declaration = change.set;
  if (declaration && typeof declaration.value === 'string') {
    slots.push({
      cssText: declaration.value,
      write: (rewritten) => {
        declaration.value = rewritten;
      },
    });
  }
  return slots;
}

function addStyleSheetChange(change: StyleSheetChange, target: CssTextTarget): (() => void)[] {
  return findCssTextSlots(change).flatMap(({ cssText, write }) => addCssText(cssText, target, write));
}

function isStyleSheetChange(event: ScreenSnapshotEvent): boolean {
  return event.type === RRWEB_INCREMENTAL_EVENT_TYPE && STYLE_SHEET_SOURCES.has((event.data as StyleSheetChange).source);
}

/** The rrweb node id of the element whose stylesheet an event changed. Undefined for any other event. */
export function findStyleSheetOwnerId(event: ScreenSnapshotEvent): number | undefined {
  if (!isStyleSheetChange(event)) {
    return undefined;
  }
  const { id } = event.data as StyleSheetChange;
  return typeof id === 'number' ? id : undefined;
}

/**
 * A copy of a stylesheet change with its URLs made absolute against the stylesheet's own address. A rule
 * set in a linked stylesheet is relative to that file, which only the live page can tell.
 */
export function resolveStyleSheetChange(event: ScreenSnapshotEvent, styleSheetUrl: string): ScreenSnapshotEvent {
  const copy = JSON.parse(JSON.stringify(event)) as ScreenSnapshotEvent;
  for (const { cssText, write } of findCssTextSlots(copy.data as StyleSheetChange)) {
    if (cssText.includes(CSS_URL_MARKER)) {
      write(resolveCssUrls(cssText, styleSheetUrl));
    }
  }
  return copy;
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

export interface SegmentedReplayAssetRoot extends ReplayAssetRoot {
  /** The file each recorded <img> node showed, for the nodes whose document noted one. */
  liveImages: Map<SnapshotNode, string>;
}

/**
 * The whole replay under one root, so files are budgeted and numbered once across its documents. Each
 * segment is read on its own because rrweb node ids start over in every document: the same id is an image
 * on one page and something else on the next.
 */
export function createSegmentedReplayAssetRoot(
  segments: readonly Pick<ReplaySegment, 'events' | 'liveImageSources'>[],
): SegmentedReplayAssetRoot {
  const liveImages = new Map<SnapshotNode, string>();
  const roots = segments.map((segment) => {
    // Events were cleaned before they were kept or stored; what came back from storage is cleaned again.
    const assetRoot = createReplayAssetRoot(segment.events, sanitizeReplayEvents(segment.events));
    const sources = new Map(segment.liveImageSources);
    const visit = (node: SnapshotNode): void => {
      const source = node.tagName === IMAGE_TAG_NAME && node.id !== undefined ? sources.get(node.id) : undefined;
      if (source !== undefined) {
        liveImages.set(node, source);
      }
      node.childNodes?.forEach(visit);
    };
    visit(assetRoot.root);
    return assetRoot;
  });
  return {
    root: { type: DOCUMENT_NODE_TYPE, childNodes: roots.flatMap((assetRoot) => assetRoot.root.childNodes ?? []) },
    applyRewrites: () => roots.forEach((assetRoot) => assetRoot.applyRewrites()),
    liveImages,
  };
}
