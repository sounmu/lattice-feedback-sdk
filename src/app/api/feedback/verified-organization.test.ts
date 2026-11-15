import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as listConversations } from '@/app/api/conversations/route';
import { GET, POST } from '@/app/api/feedback/route';
import { ADMIN_AUTHORIZATION, createFeedbackBody, createJsonRequest } from '@/app/api/feedback/feedback-test-fixtures';
import { resetRateLimit } from '@/lib/http/rate-limit';
import { resetMemoryFeedbackStore } from '@/lib/memory-feedback-repository';
import type { CreateFeedbackResponse, FeedbackListResponse } from '@/types/feedback';

const SECRET = 'organization-test-secret';
const FEEDBACK_URL = 'http://localhost:3000/api/feedback';
const CONVERSATIONS_URL = 'http://localhost:3000/api/conversations';
const organization = { id: 'acme', name: 'Acme Corp' };

function sign(payload: unknown[]) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const signature = createHmac('sha256', SECRET).update(JSON.stringify([...payload, expiresAt])).digest('hex');
  return { expiresAt, signature };
}

async function submit(reporter: Record<string, unknown>) {
  const response = await POST(createJsonRequest(FEEDBACK_URL, 'POST', createFeedbackBody({ reporter })));
  expect(response.status).toBe(201);
  return (await response.json()) as CreateFeedbackResponse;
}

beforeEach(() => {
  vi.stubEnv('FEEDBACK_IDENTITY_SECRET', SECRET);
  delete process.env.FEEDBACK_ALLOWED_ORIGINS;
  delete process.env.FEEDBACK_ADMIN_TOKEN;
  resetMemoryFeedbackStore();
  resetRateLimit();
});
afterEach(() => vi.unstubAllEnvs());

describe('verified reporter organization', () => {
  const base = { id: 'alice', name: 'Alice' };

  it('stores and returns the organization when a v2 signature covers it', async () => {
    const identity = sign(['lattice-identity-v2', 'demo', 'alice', 'acme']);
    const { feedback } = await submit({ ...base, organization, identity });

    expect(feedback.reporter.verifiedOrganization).toEqual(organization);
    expect(feedback.reporter).not.toHaveProperty('organization');
    expect(feedback.reporter).not.toHaveProperty('identity');
    const list = await GET(new Request(`${FEEDBACK_URL}?projectKey=demo`, { headers: { authorization: ADMIN_AUTHORIZATION } }));
    expect(((await list.json()) as FeedbackListResponse).items[0].reporter.verifiedOrganization).toEqual(organization);
  });

  it('drops an unsigned organization claim', async () => {
    const { feedback } = await submit({ ...base, organization });
    expect(feedback.reporter).toEqual(base);
  });

  it('drops a claimed organization that the v2 signature does not cover', async () => {
    const identity = sign(['lattice-identity-v2', 'demo', 'alice', null]);
    const { feedback } = await submit({ ...base, organization, identity });
    expect(feedback.reporter).toEqual(base);
  });

  it('drops a tampered organization id, and the proof with it', async () => {
    const identity = sign(['lattice-identity-v2', 'demo', 'alice', 'acme']);
    const { feedback } = await submit({ ...base, organization: { id: 'rival', name: 'Rival Inc' }, identity });
    expect(feedback.reporter).toEqual(base);
    const history = await listConversations(createJsonRequest(CONVERSATIONS_URL, 'POST', {
      projectKey: 'demo', hostOrigin: 'http://localhost:4000', secrets: [],
      reporter: { ...base, organization: { id: 'rival' }, identity },
    }));
    expect((await history.json()).threads).toEqual([]);
  });

  it('keeps accepting v1 signatures without verifying an organization', async () => {
    const identity = sign(['lattice-identity-v1', 'demo', 'alice']);
    const { feedback } = await submit({ ...base, organization, identity });
    expect(feedback.reporter).toEqual(base);
    const history = await listConversations(createJsonRequest(CONVERSATIONS_URL, 'POST', {
      projectKey: 'demo', hostOrigin: 'http://localhost:4000', secrets: [], reporter: { ...base, organization, identity },
    }));
    expect((await history.json()).threads.map((thread: { id: string }) => thread.id)).toEqual([feedback.id]);
  });

  it('opens verified history when the conversation request carries the signed organization', async () => {
    const identity = sign(['lattice-identity-v2', 'demo', 'alice', 'acme']);
    const { feedback } = await submit({ ...base, organization, identity });
    const history = await listConversations(createJsonRequest(CONVERSATIONS_URL, 'POST', {
      projectKey: 'demo', hostOrigin: 'http://localhost:4000', secrets: [], reporter: { ...base, organization, identity },
    }));
    expect((await history.json()).threads.map((thread: { id: string }) => thread.id)).toEqual([feedback.id]);
  });

  it('ignores a verifiedOrganization sent by the client', async () => {
    const { feedback } = await submit({ ...base, verifiedOrganization: organization });
    expect(feedback.reporter).toEqual(base);
  });
});
