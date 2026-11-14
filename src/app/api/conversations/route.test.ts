import { createHmac } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { POST, PUT } from '@/app/api/conversations/route';
import { POST as createFeedback } from '@/app/api/feedback/route';
import { PATCH as reply } from '@/app/api/feedback/[id]/route';
import { createFeedbackBody, createJsonRequest } from '@/app/api/feedback/feedback-test-fixtures';
import { getFeedbackRepository } from '@/lib/feedback-repository';
import { resetMemoryFeedbackStore } from '@/lib/memory-feedback-repository';
import { resetRateLimit } from '@/lib/http/rate-limit';
import { hashConversationSecret } from '@/lib/reporter-identity';
import { createFeedbackInputSchema } from '@/lib/validation/feedback-schema';
import { getConversationMessages, ConversationLimitError } from '@/lib/conversation';

const base = { projectKey: 'demo', hostOrigin: 'http://localhost:4000', reporter: { id: 'alice', name: 'Alice' }, secrets: [] };
const secret = 'a'.repeat(64);
const access = { browserSecretHash: hashConversationSecret(secret), verifiedReporterId: null };
const credentials = { browserSecretHashes: [access.browserSecretHash], verifiedReporterId: null };
const input = createFeedbackInputSchema.parse(createFeedbackBody({ reporter: base.reporter }));
const url = 'http://localhost:3000/api/conversations';

beforeEach(() => {
  resetMemoryFeedbackStore();
  resetRateLimit();
  vi.stubEnv('FEEDBACK_STORAGE', 'memory');
  vi.stubEnv('FEEDBACK_IDENTITY_SECRET', 'test-customer-secret');
});
afterEach(() => vi.unstubAllEnvs());

describe('reporter conversation access', () => {
  it('issues a capability at creation and exposes only its own thread', async () => {
    const response = await createFeedback(createJsonRequest('http://localhost:3000/api/feedback', 'POST', input));
    const created = await response.json();
    expect(response.status).toBe(201);
    expect(created.conversationSecret).toMatch(/^[a-f0-9]{64}$/);
    const history = await POST(createJsonRequest(url, 'POST', { ...base, secrets: [created.conversationSecret] }));
    const body = await history.json();
    expect(body.threads.map((thread: { id: string }) => thread.id)).toEqual([created.feedback.id]);
    expect(body.threads[0].messages[0]).toMatchObject({ authorRole: 'reporter', body: input.message });
    expect(body.threads[0]).not.toHaveProperty('page');
    expect(body.threads[0]).not.toHaveProperty('browserSecretHash');
  });

  it.each([
    { label: 'forged matching id', changes: {} },
    { label: 'other reporter', changes: { reporter: { id: 'bob', name: 'Bob' } } },
    { label: 'wrong secret', changes: { secrets: ['b'.repeat(64)] } },
    { label: 'other project', changes: { projectKey: 'other', secrets: [secret] } },
  ])('refuses reads and followups for $label', async ({ changes }) => {
    const feedback = await getFeedbackRepository().create(input, undefined, access);
    const request = { ...base, ...changes };
    const history = await POST(createJsonRequest(url, 'POST', request));
    if (request.projectKey === 'other') expect(history.status).toBe(404);
    else expect((await history.json()).threads).toEqual([]);
    const response = await PUT(createJsonRequest(url, 'PUT', { ...request, feedbackId: feedback.id, message: 'intrusion' }));
    expect(response.status).toBe(404);
  });

  it('accepts verified identity across browsers only for verified-created threads', async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const identity = { expiresAt, signature: createHmac('sha256', 'test-customer-secret')
      .update(JSON.stringify(['lattice-identity-v1', 'demo', 'alice', expiresAt])).digest('hex') };
    const created = await createFeedback(createJsonRequest('http://localhost:3000/api/feedback', 'POST', {
      ...input, reporter: { ...base.reporter, identity },
    }));
    const feedback = (await created.json()).feedback;
    expect(feedback.reporter).not.toHaveProperty('identity');
    const history = await POST(createJsonRequest(url, 'POST', { ...base, reporter: { ...base.reporter, identity } }));
    expect((await history.json()).threads.map((thread: { id: string }) => thread.id)).toEqual([feedback.id]);
    const forged = await POST(createJsonRequest(url, 'POST', { ...base, reporter: { id: 'bob', name: 'Bob', identity } }));
    expect((await forged.json()).threads).toEqual([]);
  });

  it('does not retroactively trust ids in unverified or legacy feedback', async () => {
    const repository = getFeedbackRepository();
    const legacy = await repository.create(input);
    await repository.create(input, undefined, access);
    expect(await repository.findMany('demo', { browserSecretHashes: [], verifiedReporterId: 'alice' })).toEqual([]);
    expect(await repository.find('demo', legacy.id, credentials)).toBeNull();
    expect(await repository.find('other', legacy.id, credentials)).toBeNull();
  });

  it('orders reporter, admin and followup messages and rejects admin impersonation', async () => {
    const feedback = await getFeedbackRepository().create(input, undefined, access);
    const context = { params: Promise.resolve({ id: feedback.id }) };
    const endpoint = `http://localhost:3000/api/feedback/${feedback.id}?projectKey=demo`;
    expect((await reply(createJsonRequest(endpoint, 'PATCH', { adminReply: 'unauthorized' }), context)).status).toBe(401);
    expect((await reply(createJsonRequest(endpoint, 'PATCH', { adminReply: 'We are checking.' }, { authorization: 'Bearer dev-admin-token' }), context)).status).toBe(200);
    const request = { ...base, secrets: [secret], feedbackId: feedback.id, message: 'Thanks.' };
    expect((await PUT(createJsonRequest(url, 'PUT', { ...request, authorRole: 'admin' }))).status).toBe(400);
    const response = await PUT(createJsonRequest(url, 'PUT', request));
    expect((await response.json()).thread.messages.map((message: { authorRole: string; body: string }) => [message.authorRole, message.body]))
      .toEqual([['reporter', input.message], ['admin', 'We are checking.'], ['reporter', 'Thanks.']]);
  });

  it('enforces body sizes and request rate on the real API', async () => {
    const feedback = await getFeedbackRepository().create(input, undefined, access);
    const request = { ...base, secrets: [secret], feedbackId: feedback.id };
    expect((await PUT(createJsonRequest(url, 'PUT', { ...request, message: 'x'.repeat(5001) }))).status).toBe(400);
    expect((await PUT(createJsonRequest(url, 'PUT', { ...request, message: 'x'.repeat(33000) }))).status).toBe(413);
    resetRateLimit();
    for (let index = 0; index < 20; index += 1) {
      expect((await PUT(createJsonRequest(url, 'PUT', { ...request, message: `message ${index}` }))).status).toBe(200);
    }
    expect((await PUT(createJsonRequest(url, 'PUT', { ...request, message: 'rate exceeded' }))).status).toBe(429);
  });

  it('enforces the thread limit atomically across concurrent appends and admin status changes', async () => {
    const repository = getFeedbackRepository();
    const feedback = await repository.create(input, undefined, access);
    for (let index = 0; index < 98; index += 1) await repository.appendReporterMessage('demo', feedback.id, { credentials, body: String(index) });
    const results = await Promise.allSettled([
      repository.appendReporterMessage('demo', feedback.id, { credentials, body: 'last' }),
      repository.update('demo', feedback.id, { adminReply: 'over limit', status: 'resolved' }),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    if (results[1].status === 'rejected') expect(results[1].reason).toBeInstanceOf(ConversationLimitError);
    const stored = await repository.find('demo', feedback.id);
    expect(stored?.status).toBe('open');
    expect(stored && getConversationMessages(stored)).toHaveLength(100);
  });

  it('presents the legacy reply once and keeps it when new messages arrive', () => {
    const legacy = { ...input, id: crypto.randomUUID(), status: 'open' as const, duplicateOfId: null, adminReply: 'Legacy answer', createdAt: '2026-11-14T00:00:00Z', updatedAt: '2026-11-14T01:00:00Z' };
    expect(getConversationMessages(legacy).map((message) => message.body)).toEqual([input.message, 'Legacy answer']);
    expect(getConversationMessages({ ...legacy, messages: [{ id: 'legacy', authorRole: 'admin', body: 'Legacy answer', createdAt: legacy.updatedAt }] })).toHaveLength(2);
  });
});
