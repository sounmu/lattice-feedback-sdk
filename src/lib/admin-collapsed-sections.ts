// Which cards of the admin detail screen the admin has folded. It is a preference, shared by every
// feedback, so it is kept in localStorage and survives a reload.
const COLLAPSED_SECTIONS_STORAGE_KEY = 'lattice-feedback:admin-collapsed-sections';
const COLLAPSED_SECTIONS_EVENT = 'lattice-feedback:admin-collapsed-sections-change';

/** Section keys read from a stored value. Anything that is not a list of strings counts as nothing folded. */
export function parseCollapsedSections(value: string | null): string[] {
  if (!value) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    // Not written by this module.
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((key): key is string => typeof key === 'string');
}

/** The folded keys after a section's heading is pressed: folds an open section, opens a folded one. */
export function toggleCollapsedSection(collapsedKeys: string[], sectionKey: string): string[] {
  if (collapsedKeys.includes(sectionKey)) {
    return collapsedKeys.filter((key) => key !== sectionKey);
  }
  return [...collapsedKeys, sectionKey];
}

// The value this tab works with. Storage only carries it across reloads, so folding still works when
// storage is blocked.
let currentValue: string | null = null;

export function subscribeToCollapsedSections(listener: () => void): () => void {
  window.addEventListener(COLLAPSED_SECTIONS_EVENT, listener);
  return () => window.removeEventListener(COLLAPSED_SECTIONS_EVENT, listener);
}

export function getCollapsedSectionsValue(): string {
  if (currentValue === null) {
    try {
      currentValue = window.localStorage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY) ?? '';
    } catch {
      currentValue = '';
    }
  }
  return currentValue;
}

export function getServerCollapsedSectionsValue(): string {
  return '';
}

export function saveCollapsedSections(collapsedKeys: string[]): void {
  currentValue = JSON.stringify(collapsedKeys);
  try {
    window.localStorage.setItem(COLLAPSED_SECTIONS_STORAGE_KEY, currentValue);
  } catch {
    // Storage can be blocked. The choice then lasts until the page is reloaded.
  }
  window.dispatchEvent(new Event(COLLAPSED_SECTIONS_EVENT));
}
