import { AutomaticMasker, type TextMaskingContext } from '@/sdk/automatic-masking';
import type { SnapshotNode } from '@/sdk/snapshot-assets';

interface RecordedTextContext extends TextMaskingContext {
  readonly tagName?: string;
  readonly parentId?: number;
}

const TEXT_ATTRIBUTES = /^(id|name|value|placeholder|title|alt|aria-label|aria-description|label|content|data-.*)$/i;
const CONTROL_ATTRIBUTES = new Set(['data-lattice-mask', 'data-lattice-block', 'data-lattice-keep']);

/** One sanitizer per snapshot/document. Stores policy context by id, never original values. */
export class SnapshotMasker {
  private readonly contexts = new Map<number, RecordedTextContext>();

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

  node(node: SnapshotNode, parentId?: number): void {
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
    for (const [name, value] of Object.entries(attributes)) {
      if (CONTROL_ATTRIBUTES.has(name)) {
        attributes[name] = '';
      } else if (TEXT_ATTRIBUTES.test(name) && typeof value === 'string') {
        // Viewport is structural metadata. Other meta content can contain business data.
        if (node.tagName === 'meta' && attributes.name === 'viewport') continue;
        attributes[name] = this.masker.text(value, context);
      }
    }
    node.childNodes?.forEach((child) => this.node(child, node.id));
  }

  text(id: number, value: string): string {
    const context = this.context(id);
    if (context.tagName === 'script') return '';
    if (context?.tagName === 'style') return value;
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
      } else if (TEXT_ATTRIBUTES.test(name) && typeof value === 'string') {
        attributes[name] = this.masker.text(value, { ...context, forced });
      }
    }
  }
}
