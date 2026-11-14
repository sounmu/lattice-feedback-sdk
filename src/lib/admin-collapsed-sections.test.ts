import { expect, it } from 'vitest';

import { parseCollapsedSections, toggleCollapsedSection } from '@/lib/admin-collapsed-sections';

it('folds an open section and opens a folded one, leaving the others as they are', () => {
  expect(toggleCollapsedSection([], 'ticket-draft')).toEqual(['ticket-draft']);
  expect(toggleCollapsedSection(['flow', 'ticket-draft'], 'flow')).toEqual(['ticket-draft']);
  expect(toggleCollapsedSection(['flow'], 'ticket-draft')).toEqual(['flow', 'ticket-draft']);
});

it('reads back what was stored', () => {
  expect(parseCollapsedSections(JSON.stringify(['flow', 'ticket-draft']))).toEqual(['flow', 'ticket-draft']);
});

it('treats a missing or unreadable stored value as nothing folded', () => {
  for (const value of [null, '', 'not json', '{"flow":true}', '"flow"']) {
    expect(parseCollapsedSections(value)).toEqual([]);
  }
  expect(parseCollapsedSections('["flow", 7, null]')).toEqual(['flow']);
});
