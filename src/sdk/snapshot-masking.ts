import { AutomaticMasker, type TextMaskingContext } from '@/sdk/automatic-masking';
import type { SnapshotNode } from '@/sdk/snapshot-assets';
import { findCssNames, rewriteReferences } from '@/sdk/structural-references';

// Displayed or submitted text. Names that other nodes point at are handled by structural-references instead.
const TEXT_ATTRIBUTES = /^(value|placeholder|title|alt|aria-label|aria-description|label|content|data-.*)$/i;
const CONTROL_ATTRIBUTES = new Set(['data-lattice-mask', 'data-lattice-block', 'data-lattice-keep']);

/** What a node declares by itself. What applies to it also depends on its ancestors, so that is derived, never stored. */
interface NodeMarkers {
  mask: boolean;
  block: boolean;
  keep: boolean;
  /** A password or hidden field stays masked when a "show password" toggle changes its type. */
  secret: boolean;
  script: boolean;
}

interface RecordedNode {
  readonly tagName?: string;
  readonly parentId?: number;
  readonly markers: NodeMarkers;
}

interface RecordedTextContext extends TextMaskingContext {
  readonly tagName?: string;
}

function readMarkers(node: SnapshotNode): NodeMarkers {
  const attributes = node.attributes ?? {};
  return {
    mask: 'data-lattice-mask' in attributes,
    block: 'data-lattice-block' in attributes,
    keep: 'data-lattice-keep' in attributes,
    secret: (node.tagName === 'input' && /password|hidden/i.test(String(attributes.type))) ||
      /password/i.test(String(attributes.autocomplete ?? '')),
    script: false,
  };
}

function isForcedBy(markers: NodeMarkers): boolean {
  return markers.mask || markers.block || markers.secret || markers.script;
}

function applyMarkerChanges(markers: NodeMarkers, attributes: NonNullable<SnapshotNode['attributes']>): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'data-lattice-keep') markers.keep = value !== null;
    else if (name === 'data-lattice-mask') markers.mask = value !== null;
    else if (name === 'data-lattice-block') markers.block = value !== null;
    else if (name === 'type' && /password|hidden/i.test(String(value))) markers.secret = true;
    else if (name === 'autocomplete' && /password/i.test(String(value))) markers.secret = true;
  }
}

/** One sanitizer per snapshot/document. Stores policy context by id, never original values. */
export class SnapshotMasker {
  private readonly nodes = new Map<number, RecordedNode>();
  private readonly children = new Map<number, Set<number>>();
  // Nodes a page change removed. A node that was only moved is recorded again by the same change.
  private readonly detached = new Set<number>();
  // Names and values the page's own stylesheets spell out. Masking one would break the rule that uses it.
  private readonly cssNames = new Set<string>();
  // A name that is not proven static becomes one opaque token everywhere it appears in this document.
  private readonly opaqueNames = new Map<string, string>();
  private opaqueCount = 0;

  constructor(
    readonly masker: AutomaticMasker,
    private readonly commentedIds: ReadonlySet<number> = new Set(),
  ) {}

  /** The exemption and the mask that apply now: the markers on the node and on every ancestor, forced masking first. */
  private context(id: number | undefined): RecordedTextContext {
    let forced = false;
    let safe = false;
    let tagName: string | undefined;
    let current = id;
    for (let hops = 0; current !== undefined && hops <= this.nodes.size; hops += 1) {
      const node = this.nodes.get(current);
      if (!node) break;
      if (current === id) tagName = node.tagName;
      forced ||= isForcedBy(node.markers);
      safe ||= node.markers.keep;
      current = node.parentId;
    }
    return { forced, safe, tagName };
  }

  private record(id: number, node: RecordedNode): void {
    const previous = this.nodes.get(id);
    if (previous?.parentId !== undefined && previous.parentId !== node.parentId) {
      this.children.get(previous.parentId)?.delete(id);
    }
    if (node.parentId !== undefined) {
      const siblings = this.children.get(node.parentId) ?? new Set<number>();
      siblings.add(id);
      this.children.set(node.parentId, siblings);
    }
    this.nodes.set(id, node);
    this.detached.delete(id);
  }

  /** The node left its parent. It is forgotten when the change ends, unless the same change put it back (a move). */
  detach(id: number): void {
    this.detached.add(id);
  }

  forgetDetached(): void {
    for (const root of this.detached) {
      const pending = [root];
      for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
        this.children.get(id)?.forEach((child) => pending.push(child));
        this.children.delete(id);
        const parentId = this.nodes.get(id)?.parentId;
        if (parentId !== undefined) this.children.get(parentId)?.delete(id);
        this.nodes.delete(id);
      }
    }
    this.detached.clear();
  }

  private readonly remapName = (name: string): string => {
    if (!name.trim() || this.cssNames.has(name) || this.masker.isStatic(name)) return name;
    let opaque = this.opaqueNames.get(name);
    if (opaque === undefined) {
      do {
        this.opaqueCount += 1;
        opaque = `lattice-ref-${this.opaqueCount}`;
      } while (this.masker.known.has(opaque));
      this.opaqueNames.set(name, opaque);
      this.masker.countMasked(name);
    }
    return opaque;
  };

  private maskAttribute(name: string, value: string, context: RecordedTextContext): string {
    if (TEXT_ATTRIBUTES.test(name)) {
      const namedByStylesheet = name.toLowerCase().startsWith('data-') && this.cssNames.has(value);
      return this.masker.text(value, namedByStylesheet ? { ...context, safe: true } : context);
    }
    return rewriteReferences(name, value, this.remapName);
  }

  private collectCssNames(node: SnapshotNode): void {
    const serialized = node.attributes?._cssText;
    if (typeof serialized === 'string') findCssNames(serialized).forEach((name) => this.cssNames.add(name));
    if (node.tagName === 'style') {
      node.childNodes?.forEach((child) => {
        if (typeof child.textContent === 'string') findCssNames(child.textContent).forEach((name) => this.cssNames.add(name));
      });
    }
    node.childNodes?.forEach((child) => this.collectCssNames(child));
  }

  node(node: SnapshotNode, parentId?: number): void {
    this.collectCssNames(node);
    this.visit(node, parentId);
  }

  private visit(node: SnapshotNode, parentId?: number): void {
    if (node.tagName === 'script') {
      for (const child of [node, ...(node.childNodes ?? [])]) {
        if (child.id === undefined) continue;
        const markers = { ...readMarkers({ type: child.type }), script: true };
        this.record(child.id, { tagName: 'script', parentId: child === node ? parentId : node.id, markers });
      }
      node.tagName = 'noscript';
      node.attributes = {};
      node.childNodes = [];
      return;
    }
    const parent = this.context(parentId);
    const attributes = node.attributes ?? {};
    const markers = readMarkers(node);
    const context: RecordedTextContext = {
      forced: parent.forced || isForcedBy(markers),
      safe: parent.safe || markers.keep,
      tagName: node.tagName ?? parent.tagName,
    };
    if (node.id !== undefined) this.record(node.id, { tagName: context.tagName, parentId, markers });
    if (typeof node.textContent === 'string' && context.tagName !== 'style') {
      node.textContent = this.masker.text(node.textContent, {
        ...context,
        // Only a direct text child of the exact pin target, never its descendants or attributes.
        commented: parentId !== undefined && this.commentedIds.has(parentId),
      });
    }
    // Viewport is structural metadata. Other meta content can contain business data.
    const isViewportMeta = node.tagName === 'meta' && attributes.name === 'viewport';
    for (const [name, value] of Object.entries(attributes)) {
      if (CONTROL_ATTRIBUTES.has(name)) {
        attributes[name] = '';
      } else if (typeof value === 'string' && !isViewportMeta) {
        attributes[name] = this.maskAttribute(name, value, context);
      }
    }
    node.childNodes?.forEach((child) => this.visit(child, node.id));
  }

  text(id: number, value: string): string {
    const context = this.context(id);
    if (context.tagName === 'script') return '';
    if (context.tagName === 'style') {
      findCssNames(value).forEach((name) => this.cssNames.add(name));
      return value;
    }
    return this.masker.text(value, context);
  }

  attributes(id: number, attributes: NonNullable<SnapshotNode['attributes']>): void {
    // The markers change first: a keep marker removed, or a mask added, in this change applies to its own values.
    const known = this.nodes.get(id);
    const markers = known ? { ...known.markers } : readMarkers({ type: 2 });
    applyMarkerChanges(markers, attributes);
    if (known || Object.values(markers).some(Boolean)) {
      this.record(id, { tagName: known?.tagName, parentId: known?.parentId, markers });
    }
    const context = this.context(id);
    for (const [name, value] of Object.entries(attributes)) {
      if (CONTROL_ATTRIBUTES.has(name)) {
        if (value !== null) attributes[name] = '';
      } else if (typeof value === 'string') {
        attributes[name] = this.maskAttribute(name, value, context);
      }
    }
  }
}
