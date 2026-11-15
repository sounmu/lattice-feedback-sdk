import { describe, expect, it } from 'vitest';

import {
  findConversationSecrets,
  getConversationStorageKey,
  storeConversationSecret,
  type ConversationSecretStorage,
} from '@/lib/browser-conversations';

const ALICE_SECRET = 'a'.repeat(64);
const BOB_SECRET = 'b'.repeat(64);

function createStorage(): ConversationSecretStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function getKey(reporterId: string | null): string {
  return getConversationStorageKey('demo', 'http://host.test', reporterId);
}

describe('capability storage per reporter', () => {
  it('never returns one user\'s secrets for another user or for no user', () => {
    const storage = createStorage();
    storeConversationSecret(storage, getKey('alice-isolated'), ALICE_SECRET);

    expect(findConversationSecrets(storage, getKey('alice-isolated'))).toEqual([ALICE_SECRET]);
    expect(findConversationSecrets(storage, getKey('bob-isolated'))).toEqual([]);
    expect(findConversationSecrets(storage, getKey(null))).toEqual([]);
  });

  it('keeps a secret under the user who submitted, and gives it back when that user returns', () => {
    const storage = createStorage();
    storeConversationSecret(storage, getKey('alice-return'), ALICE_SECRET);
    storeConversationSecret(storage, getKey('bob-return'), BOB_SECRET);

    expect(findConversationSecrets(storage, getKey('bob-return'))).toEqual([BOB_SECRET]);
    expect(findConversationSecrets(storage, getKey('alice-return'))).toEqual([ALICE_SECRET]);
  });

  it('keeps a missing user apart from a user whose id is the word anonymous, and from other origins', () => {
    const storage = createStorage();
    storeConversationSecret(storage, getKey(null), ALICE_SECRET);

    expect(findConversationSecrets(storage, getKey('anonymous'))).toEqual([]);
    expect(findConversationSecrets(storage, getKey(null))).toEqual([ALICE_SECRET]);
    expect(findConversationSecrets(storage, getConversationStorageKey('demo', 'http://other.test', null))).toEqual([]);
  });

  it('keeps secrets per user for the widget session when storage is blocked', () => {
    storeConversationSecret(null, getKey('alice-blocked'), ALICE_SECRET);

    expect(findConversationSecrets(null, getKey('alice-blocked'))).toEqual([ALICE_SECRET]);
    expect(findConversationSecrets(null, getKey('bob-blocked'))).toEqual([]);
  });
});
