export interface AttachmentCounts {
  comments: number;
  edits: number;
  flows: number;
  screens: number;
}

export type AttachmentChangeKind = 'comment' | 'edit' | 'flow' | 'screen';

export interface AttachmentChange {
  kind: AttachmentChangeKind;
  direction: 'added' | 'removed';
  total: number;
}

const COUNT_KEYS: { kind: AttachmentChangeKind; key: keyof AttachmentCounts }[] = [
  { kind: 'comment', key: 'comments' },
  { kind: 'edit', key: 'edits' },
  { kind: 'flow', key: 'flows' },
  { kind: 'screen', key: 'screens' },
];

/**
 * The one change worth announcing. An addition wins over a removal because the reporter's own action
 * (attaching) matters more than the screen that was replaced alongside it; screens come last because
 * they are usually saved as a side effect of a comment, an edit or a flow.
 */
export function findAttachmentChange(previous: AttachmentCounts, next: AttachmentCounts): AttachmentChange | null {
  for (const direction of ['added', 'removed'] as const) {
    for (const { kind, key } of COUNT_KEYS) {
      const delta = next[key] - previous[key];
      if ((direction === 'added' && delta > 0) || (direction === 'removed' && delta < 0)) {
        return { kind, direction, total: next[key] };
      }
    }
  }
  return null;
}
