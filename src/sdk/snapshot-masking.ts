import { AutomaticMasker, type TextMaskingContext } from '@/sdk/automatic-masking';
import type { SnapshotNode, SnapshotStyleChange } from '@/sdk/snapshot-assets';
import {
  findSelectorRanges, isVerbatimWithoutReplacements, maskOutsideRanges, rewriteCssNames, scanCssSelectors, type AttributeSelector,
} from '@/sdk/css-selectors';
import { rewriteReferences } from '@/sdk/structural-references';

// Displayed or submitted text. Names that other nodes point at are handled by structural-references instead.
const TEXT_ATTRIBUTES = /^(value|placeholder|title|alt|aria-label|aria-description|aria-valuetext|aria-roledescription|aria-placeholder|aria-braillelabel|aria-brailleroledescription|label|content|abbr|summary|datetime|download|data-.*)$/i;
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
  // Names the page's own stylesheets spell out. Masking one would break the rule that uses it.
  private readonly cssNames = new Set<string>();
  // What stylesheets select data-* attributes by, per attribute: the part of a value a selector needs stays readable.
  private readonly dataSelectors = new Map<string, AttributeSelector[]>();
  private readonly knownSelectors = new Set<string>();
  // A name that is not proven static becomes one opaque token everywhere it appears in this document, stylesheets that arrive later included.
  private readonly opaqueNames = new Map<string, string>();
  // The tokens handed out. A page name spelled like one of them gets a token of its own, or two nodes would share a name.
  private readonly issuedTokens = new Set<string>();
  private opaqueCount = 0;
  // The names each stylesheet text of the tree being cleaned mentions. A text is read once, where its names are
  // collected, and not again where it is rewritten. Empty outside node().
  private readonly treeCssNames = new Map<string, ReadonlySet<string>>();

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
    // A name that has a token keeps it, whatever stylesheets or the index learn afterwards.
    const established = this.opaqueNames.get(name);
    if (established !== undefined) return established;
    if (!name.trim()) return name;
    const isKept = this.cssNames.has(name) || this.masker.isStatic(name);
    if (isKept && !this.issuedTokens.has(name)) return name;
    let opaque: string;
    do {
      this.opaqueCount += 1;
      opaque = `lattice-ref-${this.opaqueCount}`;
    } while (this.masker.known.has(opaque) || this.cssNames.has(opaque));
    this.opaqueNames.set(name, opaque);
    this.issuedTokens.add(opaque);
    this.masker.countMasked(name);
    return opaque;
  };

  private maskAttribute(name: string, value: string, context: RecordedTextContext): string {
    if (name === '_cssText') return this.css(value);
    if (TEXT_ATTRIBUTES.test(name)) return this.maskTextAttribute(name, value, context);
    return rewriteReferences(name, value, this.remapName);
  }

  // Only the attribute a selector names, and only the part of its value that selector depends on, stays readable.
  private maskTextAttribute(name: string, value: string, context: RecordedTextContext): string {
    const selectors = this.dataSelectors.get(name.toLowerCase());
    if (!selectors || context.forced || this.masker.isStatic(value, context)) return this.masker.text(value, context);
    return maskOutsideRanges(value, findSelectorRanges(value, selectors), (gap) => this.masker.text(gap, context));
  }

  private registerCss(cssText: string): ReadonlySet<string> {
    const { names, dataSelectors } = scanCssSelectors(cssText);
    names.forEach((name) => {
      if (!this.opaqueNames.has(name) && !this.issuedTokens.has(name)) this.cssNames.add(name);
    });
    for (const selector of dataSelectors) {
      const key = [selector.attribute, selector.operator, selector.ignoreCase, selector.value].join('\u0000');
      if (this.knownSelectors.has(key)) continue;
      this.knownSelectors.add(key);
      this.dataSelectors.set(selector.attribute, [...(this.dataSelectors.get(selector.attribute) ?? []), selector]);
    }
    return names;
  }

  private hasToken(names: ReadonlySet<string>): boolean {
    // A token is only ever issued together with the name it stands for.
    if (this.opaqueNames.size === 0) return false;
    for (const name of names) {
      if (this.opaqueNames.has(name) || this.issuedTokens.has(name)) return true;
    }
    return false;
  }

  /** Stylesheet text from any route: names it mentions that already have a token are written with it, the rest stay. */
  css(cssText: string): string {
    // Registering a text again adds nothing, so a text of the tree being cleaned is not read a second time.
    const names = this.treeCssNames.get(cssText) ?? this.registerCss(cssText);
    if (isVerbatimWithoutReplacements(cssText) && !this.hasToken(names)) return cssText;
    return rewriteCssNames(cssText, (name) => this.opaqueNames.get(name) ?? (this.issuedTokens.has(name) ? this.remapName(name) : undefined));
  }

  private collectCss(cssText: string): void {
    if (!this.treeCssNames.has(cssText)) this.treeCssNames.set(cssText, this.registerCss(cssText));
  }

  private collectCssNames(node: SnapshotNode): void {
    const serialized = node.attributes?._cssText;
    if (typeof serialized === 'string') this.collectCss(serialized);
    if (node.tagName === 'style') {
      node.childNodes?.forEach((child) => {
        if (typeof child.textContent === 'string') this.collectCss(child.textContent);
      });
    }
    node.childNodes?.forEach((child) => this.collectCssNames(child));
  }

  // A node that is serialized again keeps what it was known to be: a password field stays a secret after its type changed.
  private withEstablishedMarkers(id: number | undefined, markers: NodeMarkers): NodeMarkers {
    const established = id === undefined ? undefined : this.nodes.get(id)?.markers;
    if (!established) return markers;
    return { ...markers, secret: markers.secret || established.secret, script: markers.script || established.script };
  }

  node(node: SnapshotNode, parentId?: number): void {
    this.collectCssNames(node);
    this.visit(node, parentId);
    this.treeCssNames.clear();
  }

  private visit(node: SnapshotNode, parentId?: number): void {
    if (node.tagName === 'script') {
      for (const child of [node, ...(node.childNodes ?? [])]) {
        if (child.id === undefined) continue;
        const markers = this.withEstablishedMarkers(child.id, { ...readMarkers({ type: child.type }), script: true });
        this.record(child.id, { tagName: 'script', parentId: child === node ? parentId : node.id, markers });
      }
      node.tagName = 'noscript';
      node.attributes = {};
      node.childNodes = [];
      return;
    }
    const parent = this.context(parentId);
    const attributes = node.attributes ?? {};
    const markers = this.withEstablishedMarkers(node.id, readMarkers(node));
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
    } else if (typeof node.textContent === 'string') {
      node.textContent = this.css(node.textContent);
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
    if (context.tagName === 'style') return this.css(value);
    return this.masker.text(value, context);
  }

  /** Only the marker changes of an attribute change. A page change applies these before it classifies what it adds. */
  markers(id: number, attributes: NonNullable<SnapshotNode['attributes']>): void {
    const known = this.nodes.get(id);
    const markers = known ? { ...known.markers } : readMarkers({ type: 2 });
    applyMarkerChanges(markers, attributes);
    if (known || Object.values(markers).some(Boolean)) {
      this.record(id, { tagName: known?.tagName, parentId: known?.parentId, markers });
    }
  }

  /** The value of one style declaration: a url(#name) in it follows the same mapping as in an attribute. */
  declaration(value: string): string {
    return rewriteReferences('style', value, this.remapName);
  }

  // rrweb records a changed inline style property by property. A url(#name) in one follows the same mapping as in text.
  private rewriteStyleChange(name: string, style: SnapshotStyleChange): void {
    for (const [property, value] of Object.entries(style)) {
      if (typeof value === 'string') {
        style[property] = rewriteReferences(name, value, this.remapName);
      } else if (Array.isArray(value)) {
        style[property] = [rewriteReferences(name, value[0], this.remapName), value[1]];
      }
    }
  }

  attributes(id: number, attributes: NonNullable<SnapshotNode['attributes']>): void {
    // The markers change first: a keep marker removed, or a mask added, in this change applies to its own values.
    this.markers(id, attributes);
    const context = this.context(id);
    for (const [name, value] of Object.entries(attributes)) {
      if (CONTROL_ATTRIBUTES.has(name)) {
        if (value !== null) attributes[name] = '';
      } else if (typeof value === 'string') {
        attributes[name] = this.maskAttribute(name, value, context);
      } else if (typeof value === 'object' && value !== null) {
        this.rewriteStyleChange(name, value);
      }
    }
  }
}
