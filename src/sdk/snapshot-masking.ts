import { AutomaticMasker, type TextMaskingContext } from '@/sdk/automatic-masking';
import type { SnapshotNode } from '@/sdk/snapshot-assets';
import { findCssNames, rewriteReferences } from '@/sdk/structural-references';

interface RecordedTextContext extends TextMaskingContext {
  readonly tagName?: string;
  readonly parentId?: number;
}

// Displayed or submitted text. Names that other nodes point at are handled by structural-references instead.
const TEXT_ATTRIBUTES = /^(value|placeholder|title|alt|aria-label|aria-description|label|content|data-.*)$/i;
const CONTROL_ATTRIBUTES = new Set(['data-lattice-mask', 'data-lattice-block', 'data-lattice-keep']);

/** One sanitizer per snapshot/document. Stores policy context by id, never original values. */
export class SnapshotMasker {
  private readonly contexts = new Map<number, RecordedTextContext>();
  // Names and values the page's own stylesheets spell out. Masking one would break the rule that uses it.
  private readonly cssNames = new Set<string>();
  // A name that is not proven static becomes one opaque token everywhere it appears in this document.
  private readonly opaqueNames = new Map<string, string>();
  private opaqueCount = 0;

  constructor(
    readonly masker: AutomaticMasker,
    private readonly commentedIds: ReadonlySet<number> = new Set(),
  ) {}

  private context(id: number | undefined): RecordedTextContext {
    const own = id === undefined ? undefined : this.contexts.get(id);
    if (!own) return {};
    const parent = this.context(own.parentId);
    return { ...own, forced: own.forced || parent.forced, safe: own.safe || parent.safe };
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
        if (child.id !== undefined) this.contexts.set(child.id, { tagName: 'script', forced: true });
      }
      node.tagName = 'noscript';
      node.attributes = {};
      node.childNodes = [];
      return;
    }
    const parent = this.context(parentId);
    const attributes = node.attributes ?? {};
    const forced = parent.forced || 'data-lattice-mask' in attributes || 'data-lattice-block' in attributes ||
      (node.tagName === 'input' && /password|hidden/.test(String(attributes.type))) ||
      /password/.test(String(attributes.autocomplete ?? ''));
    const context: RecordedTextContext = {
      forced,
      safe: parent.safe || 'data-lattice-keep' in attributes,
      tagName: node.tagName ?? parent.tagName,
      parentId,
    };
    if (node.id !== undefined) this.contexts.set(node.id, context);
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
    if (context?.tagName === 'style') {
      findCssNames(value).forEach((name) => this.cssNames.add(name));
      return value;
    }
    return this.masker.text(value, context);
  }

  attributes(id: number, attributes: NonNullable<SnapshotNode['attributes']>): void {
    const context = this.context(id);
    // Attribute mutations can introduce a mask; never let a later safe marker undo it.
    const forced = context?.forced || 'data-lattice-mask' in attributes || 'data-lattice-block' in attributes ||
      /password|hidden/.test(String(attributes.type ?? '')) || /password/.test(String(attributes.autocomplete ?? ''));
    if (forced) this.contexts.set(id, { ...context, forced });
    for (const [name, value] of Object.entries(attributes)) {
      if (CONTROL_ATTRIBUTES.has(name)) {
        if (value !== null) attributes[name] = '';
      } else if (typeof value === 'string') {
        attributes[name] = this.maskAttribute(name, value, { ...context, forced });
      }
    }
  }
}
