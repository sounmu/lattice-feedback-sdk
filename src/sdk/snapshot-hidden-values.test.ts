import { expect, it } from 'vitest';
import type { SnapshotNode } from '@/sdk/snapshot-assets';
import { removeHiddenValues } from '@/sdk/snapshot-hidden-values';

function createElement(tagName: string, attributes: Record<string, string>, childNodes: SnapshotNode[] = []): SnapshotNode {
  return { type: 2, tagName, attributes, childNodes };
}

it('removes hidden input values and token meta contents at every depth, and keeps visible values', () => {
  const hidden = createElement('input', { type: 'HIDDEN', name: 'authenticity_token', value: 'CSRF-SECRET' });
  const visible = createElement('input', { type: 'text', name: 'title', value: 'Visible title' });
  const csrfMeta = createElement('meta', { name: 'csrf-token', content: 'META-SECRET' });
  const viewportMeta = createElement('meta', { name: 'viewport', content: 'width=device-width' });
  const form = createElement('form', {}, [hidden, visible]);

  removeHiddenValues({ type: 0, childNodes: [createElement('head', {}, [csrfMeta, viewportMeta]), createElement('body', {}, [form])] });

  expect(hidden.attributes).toEqual({ type: 'HIDDEN', name: 'authenticity_token' });
  expect(visible.attributes?.value).toBe('Visible title');
  expect(csrfMeta.attributes).toEqual({ name: 'csrf-token' });
  expect(viewportMeta.attributes?.content).toBe('width=device-width');
});
