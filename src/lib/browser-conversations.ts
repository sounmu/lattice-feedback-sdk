import { z } from 'zod';

const secretsSchema = z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(100);
const sessionSecrets = new Map<string, string[]>();
export const CONVERSATION_SAVED_EVENT = 'lattice:conversation-saved';

function getKey(projectKey: string, hostOrigin: string): string {
  return `lattice:conversations:${JSON.stringify([projectKey, hostOrigin])}`;
}

export function getBrowserConversationSecrets(projectKey: string, hostOrigin: string): string[] {
  const key = getKey(projectKey, hostOrigin);
  try {
    const parsed = secretsSchema.safeParse(JSON.parse(window.localStorage.getItem(key) ?? '[]'));
    return [...new Set([...(parsed.success ? parsed.data : []), ...(sessionSecrets.get(key) ?? [])])].slice(-100);
  } catch {
    return sessionSecrets.get(key) ?? [];
  }
}

export function rememberConversationSecret(projectKey: string, hostOrigin: string, secret: string): boolean {
  const key = getKey(projectKey, hostOrigin);
  const secrets = [...new Set([...getBrowserConversationSecrets(projectKey, hostOrigin), secret])].slice(-100);
  sessionSecrets.set(key, secrets);
  let persisted = true;
  try {
    window.localStorage.setItem(key, JSON.stringify(secrets));
  } catch {
    persisted = false;
  }
  window.dispatchEvent(new Event(CONVERSATION_SAVED_EVENT));
  return persisted;
}
