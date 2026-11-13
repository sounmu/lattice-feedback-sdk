// The admin token lives in sessionStorage so it disappears when the tab closes.
// The keys match the saved-screen viewer (ScreenSnapshotViewer), so one sign-in covers both.
export const ADMIN_TOKEN_STORAGE_KEY = 'lattice-feedback:admin-token';
export const ADMIN_TOKEN_EVENT = 'lattice-feedback:admin-token-change';
export const DEFAULT_ADMIN_PROJECT_KEY = 'demo';

export function subscribeToAdminToken(listener: () => void): () => void {
  window.addEventListener(ADMIN_TOKEN_EVENT, listener);
  return () => window.removeEventListener(ADMIN_TOKEN_EVENT, listener);
}

export function getStoredAdminToken(): string {
  try {
    return window.sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function getServerAdminToken(): string {
  return '';
}

/** An empty token signs the admin out. */
export function saveAdminToken(token: string): void {
  try {
    if (token === '') {
      window.sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
    }
  } catch {
    // Storage can be blocked. The token then simply is not remembered.
  }
  window.dispatchEvent(new Event(ADMIN_TOKEN_EVENT));
}
