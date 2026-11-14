'use client';

import { useSyncExternalStore } from 'react';

import {
  getCollapsedSectionsValue,
  getServerCollapsedSectionsValue,
  parseCollapsedSections,
  saveCollapsedSections,
  subscribeToCollapsedSections,
  toggleCollapsedSection,
} from '@/lib/admin-collapsed-sections';

interface CollapsedSection {
  isCollapsed: boolean;
  toggle: () => void;
}

/** Whether the admin has folded a section, and the action that folds or opens it everywhere it is shown. */
export function useCollapsedSection(sectionKey: string): CollapsedSection {
  const value = useSyncExternalStore(subscribeToCollapsedSections, getCollapsedSectionsValue, getServerCollapsedSectionsValue);

  function toggle() {
    saveCollapsedSections(toggleCollapsedSection(parseCollapsedSections(getCollapsedSectionsValue()), sectionKey));
  }

  return { isCollapsed: parseCollapsedSections(value).includes(sectionKey), toggle };
}
