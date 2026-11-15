import { z } from 'zod';

const secretsSchema = z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(100);
const sessionSecrets = new Map<string, string[]>();
export const CONVERSATION_SAVED_EVENT = 'lattice:conversation-saved';

/** The part of browser storage the capabilities use. window.localStorage fits. */
export type ConversationSecretStorage = Pick<Storage, 'getItem' | 'setItem'>;

// Capabilities belong to the reporter who submitted. A missing user is its own bucket (null), which
// no reporter id can equal, so signing out or in as someone else never reuses another account's access.
export function getConversationStorageKey(projectKey: string, hostOrigin: string, reporterId: string | null): string {
  return `lattice:conversations:${JSON.stringify([projectKey, hostOrigin, reporterId])}`;
}

export function findConversationSecrets(storage: ConversationSecretStorage | null, key: string): string[] {
  const inSession = sessionSecrets.get(key) ?? [];
  try {
    const parsed = secretsSchema.safeParse(JSON.parse(storage?.getItem(key) ?? '[]'));
    return [...new Set([...(parsed.success ? parsed.data : []), ...inSession])].slice(-100);
  } catch {
    return inSession;
  }
}

/** Returns false when the secret could only be kept for this widget session. */
export function storeConversationSecret(storage: ConversationSecretStorage | null, key: string, secret: string): boolean {
  const secrets = [...new Set([...findConversationSecrets(storage, key), secret])].slice(-100);
  sessionSecrets.set(key, secrets);
  try {
    storage?.setItem(key, JSON.stringify(secrets));
    return storage !== null;
  } catch {
    return false;
  }
}

function getBrowserStorage(): ConversationSecretStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getBrowserConversationSecrets(projectKey: string, hostOrigin: string, reporterId: string | null): string[] {
  return findConversationSecrets(getBrowserStorage(), getConversationStorageKey(projectKey, hostOrigin, reporterId));
}

export function rememberConversationSecret(projectKey: string, hostOrigin: string, reporterId: string | null, secret: string): boolean {
  const persisted = storeConversationSecret(getBrowserStorage(), getConversationStorageKey(projectKey, hostOrigin, reporterId), secret);
  window.dispatchEvent(new Event(CONVERSATION_SAVED_EVENT));
  return persisted;
}
