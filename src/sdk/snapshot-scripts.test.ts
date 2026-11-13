import { expect, it } from 'vitest';
import type { SnapshotNode } from '@/sdk/snapshot-assets';
import { removeInlineScripts } from '@/sdk/snapshot-scripts';

function createElement(tagName: string, attributes: Record<string, string>, childNodes: SnapshotNode[] = []): SnapshotNode {
  return { type: 2, tagName, attributes, childNodes };
}

it('removes event handlers, javascript: URLs and srcdoc markup at every depth and keeps the rest', () => {
  const button = createElement('button', { id: 'save', onclick: 'steal()', ONMOUSEOVER: 'steal()' });
  const link = createElement('a', { href: ' \tJava\nScript:steal()', title: 'Open the javascript: guide' });
  const frame = createElement('iframe', { srcdoc: '<script>steal()</script>', width: '300' });
  const form = createElement('form', { action: 'javascript:steal()', 'data-once': 'kept' }, [button, link, frame]);
  const image = createElement('img', { src: 'https://host.example.com/logo.png', alt: 'onload' });

  removeInlineScripts({ type: 0, childNodes: [createElement('body', {}, [form, image])] });

  expect(button.attributes).toEqual({ id: 'save' });
  expect(link.attributes).toEqual({ title: 'Open the javascript: guide' });
  expect(frame.attributes).toEqual({ width: '300' });
  expect(form.attributes).toEqual({ 'data-once': 'kept' });
  expect(image.attributes).toEqual({ src: 'https://host.example.com/logo.png', alt: 'onload' });
});
