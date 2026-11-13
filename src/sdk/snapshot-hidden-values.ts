// Hidden inputs and token meta tags often carry CSRF or session tokens. rrweb's input masking does not
// cover type="hidden", and these values are never visible, so they are removed from the serialized
// snapshot before it leaves the page (AGENTS.md section 5: tokens are never collected).
import type { SnapshotNode } from '@/sdk/snapshot-assets';

const TOKEN_META_NAME_PATTERN = /csrf|xsrf|token|nonce|session|secret|key/i;

function isHiddenInput(node: SnapshotNode): boolean {
  return node.tagName === 'input' && String(node.attributes?.type ?? '').toLowerCase() === 'hidden';
}

function isTokenMeta(node: SnapshotNode): boolean {
  const name = node.attributes?.name ?? node.attributes?.['http-equiv'];
  return node.tagName === 'meta' && typeof name === 'string' && TOKEN_META_NAME_PATTERN.test(name);
}

export function removeHiddenValues(root: SnapshotNode): void {
  const attributes = root.attributes;
  if (attributes && isHiddenInput(root)) {
    delete attributes.value;
  }
  if (attributes && isTokenMeta(root)) {
    delete attributes.content;
  }
  root.childNodes?.forEach(removeHiddenValues);
}
