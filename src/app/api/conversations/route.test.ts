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
import { ANONYMOUS_REPORTER_ID, getConversationMessages, ConversationLimitError } from '@/lib/conversation';

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

  it.each([
    { label: 'another user', reporter: { id: 'bob', name: 'Bob' } },
    { label: 'no user', reporter: null },
  ])('refuses a valid capability presented for $label after the browser user changed', async ({ reporter }) => {
    const feedback = await getFeedbackRepository().create(input, undefined, access);
    const request = { ...base, reporter, secrets: [secret] };
    expect((await (await POST(createJsonRequest(url, 'POST', request))).json()).threads).toEqual([]);
    const response = await PUT(createJsonRequest(url, 'PUT', { ...request, feedbackId: feedback.id, message: 'intrusion' }));
    expect(response.status).toBe(404);
    expect((await getFeedbackRepository().find('demo', feedback.id))?.messages).toEqual([]);
    const owner = await POST(createJsonRequest(url, 'POST', { ...base, secrets: [secret] }));
    expect((await owner.json()).threads.map((thread: { id: string }) => thread.id)).toEqual([feedback.id]);
  });

  it('lets a browser without a user continue the conversation it created', async () => {
    const anonymousInput = createFeedbackInputSchema.parse(createFeedbackBody({ reporter: { id: ANONYMOUS_REPORTER_ID, name: 'Anonymous' } }));
    const feedback = await getFeedbackRepository().create(anonymousInput, undefined, access);
    const request = { ...base, reporter: null, secrets: [secret] };
    const history = await POST(createJsonRequest(url, 'POST', request));
    expect((await history.json()).threads.map((thread: { id: string }) => thread.id)).toEqual([feedback.id]);
    const response = await PUT(createJsonRequest(url, 'PUT', { ...request, feedbackId: feedback.id, message: 'More detail.' }));
    expect(response.status).toBe(200);
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
    const legacy = { ...input, id: crypto.randomUUID(), status: 'open' as const, duplicateOfId: null, ticketUrl: null, adminReply: 'Legacy answer', createdAt: '2026-11-14T00:00:00Z', updatedAt: '2026-11-14T01:00:00Z' };
    expect(getConversationMessages(legacy).map((message) => message.body)).toEqual([input.message, 'Legacy answer']);
    expect(getConversationMessages({ ...legacy, messages: [{ id: 'legacy', authorRole: 'admin', body: 'Legacy answer', createdAt: legacy.updatedAt }] })).toHaveLength(2);
  });
});

describe('requireVerifiedIdentity', () => {
  const feedbackUrl = 'http://localhost:3000/api/feedback';

  function signIdentity(id: string) {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const signature = createHmac('sha256', 'test-customer-secret')
      .update(JSON.stringify(['lattice-identity-v1', 'demo', id, expiresAt])).digest('hex');
    return { expiresAt, signature };
  }

  function getSignedReporter(id: string, name: string) {
    return { id, name, identity: signIdentity(id) };
  }

  async function findStoredIds() {
    return (await getFeedbackRepository().findMany('demo')).map((item) => item.id);
  }

  describe('when on', () => {
    beforeEach(() => vi.stubEnv('FEEDBACK_REQUIRE_VERIFIED_IDENTITY', 'true'));

    it('lets a verified user send feedback without issuing a browser capability and see only their own threads', async () => {
      const created = await createFeedback(createJsonRequest(feedbackUrl, 'POST', { ...input, reporter: getSignedReporter('alice', 'Alice') }));
      const body = await created.json();
      expect(created.status).toBe(201);
      expect(body).not.toHaveProperty('conversationSecret');
      const history = await POST(createJsonRequest(url, 'POST', { ...base, reporter: getSignedReporter('alice', 'Alice') }));
      expect((await history.json()).threads.map((thread: { id: string }) => thread.id)).toEqual([body.feedback.id]);
      const other = await POST(createJsonRequest(url, 'POST', { ...base, reporter: getSignedReporter('bob', 'Bob') }));
      expect((await other.json()).threads).toEqual([]);
    });

    it('refuses to list with browser secrets alone or without a valid signature', async () => {
      await getFeedbackRepository().create(input, undefined, access);
      const forged = { ...base.reporter, identity: { ...signIdentity('alice'), signature: 'c'.repeat(64) } };
      for (const request of [
        { ...base, secrets: [secret] },
        { ...base, reporter: null, secrets: [secret] },
        { ...base, reporter: forged, secrets: [secret] },
      ]) {
        const response = await POST(createJsonRequest(url, 'POST', request));
        expect(response.status).toBe(401);
        expect((await response.json()).error.code).toBe('verification_required');
      }
    });

    it('matches threads by verified reporter id only, ignoring browser secrets', async () => {
      await getFeedbackRepository().create(input, undefined, access);
      const response = await POST(createJsonRequest(url, 'POST', { ...base, reporter: getSignedReporter('alice', 'Alice'), secrets: [secret] }));
      expect(response.status).toBe(200);
      expect((await response.json()).threads).toEqual([]);
    });

    it('refuses follow-ups without a signature and accepts them with one', async () => {
      const created = await createFeedback(createJsonRequest(feedbackUrl, 'POST', { ...input, reporter: getSignedReporter('alice', 'Alice') }));
      const feedbackId = (await created.json()).feedback.id;
      const unsigned = await PUT(createJsonRequest(url, 'PUT', { ...base, secrets: [secret], feedbackId, message: 'intrusion' }));
      expect(unsigned.status).toBe(401);
      expect((await getFeedbackRepository().find('demo', feedbackId))?.messages ?? []).toEqual([]);
      const signed = await PUT(createJsonRequest(url, 'PUT', { ...base, reporter: getSignedReporter('alice', 'Alice'), feedbackId, message: 'More detail.' }));
      expect(signed.status).toBe(200);
      expect((await signed.json()).thread.messages.at(-1)).toMatchObject({ authorRole: 'reporter', body: 'More detail.' });
    });

    it('refuses new feedback without a valid signature and stores nothing', async () => {
      const forged = { ...base.reporter, identity: { ...signIdentity('alice'), signature: 'c'.repeat(64) } };
      for (const reporter of [base.reporter, forged]) {
        const response = await createFeedback(createJsonRequest(feedbackUrl, 'POST', { ...input, reporter }));
        expect(response.status).toBe(401);
        expect((await response.json()).error.code).toBe('verification_required');
      }
      expect(await findStoredIds()).toEqual([]);
    });

    it('fails closed and logs a warning when no identity secret is configured', async () => {
      vi.stubEnv('FEEDBACK_IDENTITY_SECRET', '');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const reporter = getSignedReporter('alice', 'Alice');
      const created = await createFeedback(createJsonRequest(feedbackUrl, 'POST', { ...input, reporter }));
      expect(created.status).toBe(401);
      const history = await POST(createJsonRequest(url, 'POST', { ...base, reporter }));
      expect(history.status).toBe(401);
      expect(await findStoredIds()).toEqual([]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('FEEDBACK_IDENTITY_SECRET'));
      warn.mockRestore();
    });
  });

  describe('when off', () => {
    it.each(['', 'false'])('keeps text-only feedback and browser capabilities working for %j', async (value) => {
      vi.stubEnv('FEEDBACK_REQUIRE_VERIFIED_IDENTITY', value);
      const created = await createFeedback(createJsonRequest(feedbackUrl, 'POST', input));
      const body = await created.json();
      expect(created.status).toBe(201);
      expect(body.conversationSecret).toMatch(/^[a-f0-9]{64}$/);
      const history = await POST(createJsonRequest(url, 'POST', { ...base, secrets: [body.conversationSecret] }));
      expect((await history.json()).threads.map((thread: { id: string }) => thread.id)).toEqual([body.feedback.id]);
    });
  });
});
