export type AdminLoadStatus = 'unauthenticated' | 'unauthorized' | 'loading' | 'ready' | 'error';

export interface AdminLoadSnapshot {
  hasData: boolean;
  /** HTTP status of the latest failed request, or null when the latest request succeeded. */
  errorStatus: number | null;
}

const UNAUTHORIZED_STATUS = 401;

/**
 * Decides which screen the admin sees. `snapshot` is null until the first response for the
 * current token and project arrives. Data that was already loaded stays visible when a later
 * refresh fails, so a flaky network does not blank the list.
 */
export function findAdminLoadStatus(token: string, snapshot: AdminLoadSnapshot | null): AdminLoadStatus {
  if (token === '') {
    return 'unauthenticated';
  }
  if (snapshot === null) {
    return 'loading';
  }
  if (snapshot.errorStatus === UNAUTHORIZED_STATUS) {
    return 'unauthorized';
  }
  if (snapshot.hasData) {
    return 'ready';
  }
  if (snapshot.errorStatus !== null) {
    return 'error';
  }
  return 'loading';
}
