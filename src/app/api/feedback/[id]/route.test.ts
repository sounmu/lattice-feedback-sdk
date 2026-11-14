import { beforeEach, describe, expect, it } from 'vitest';
import { GET, PATCH } from '@/app/api/feedback/[id]/route';
import {
  ADMIN_AUTHORIZATION,
  createFeedbackBody,
  createJsonRequest,
} from '@/app/api/feedback/feedback-test-fixtures';
import { POST } from '@/app/api/feedback/route';
import { getFeedbackRepository } from '@/lib/feedback-repository';
import { resetMemoryFeedbackStore } from '@/lib/memory-feedback-repository';
import { createFeedbackInputSchema } from '@/lib/validation/feedback-schema';
import type { ApiErrorResponse, CreateFeedbackResponse, FeedbackDetailResponse } from '@/types/feedback';

const COLLECTION_URL = 'http://localhost:4000/api/feedback';

function createContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function createDetailUrl(id: string, projectKey = 'demo') {
  return `${COLLECTION_URL}/${id}?projectKey=${projectKey}`;
}

async function createFeedbackId(): Promise<string> {
  const response = await POST(createJsonRequest(COLLECTION_URL, 'POST', createFeedbackBody()));
  const body = (await response.json()) as CreateFeedbackResponse;
  return body.feedback.id;
}

// Stored directly: the POST route limits how many feedbacks one test file may send.
async function createStoredFeedbackId(projectKey = 'demo'): Promise<string> {
  const input = createFeedbackInputSchema.parse(createFeedbackBody());
  const feedback = await getFeedbackRepository().create({ ...input, projectKey });
  return feedback.id;
}

beforeEach(() => {
  delete process.env.FEEDBACK_ALLOWED_ORIGINS;
  delete process.env.FEEDBACK_ADMIN_TOKEN;
  resetMemoryFeedbackStore();
});

describe('GET /api/feedback/[id]', () => {
  it('returns 200 with the item for the admin token', async () => {
    const id = await createFeedbackId();
    const request = new Request(createDetailUrl(id), { headers: { authorization: ADMIN_AUTHORIZATION } });
    const response = await GET(request, createContext(id));
    const body = (await response.json()) as FeedbackDetailResponse;

    expect(response.status).toBe(200);
    expect(body.feedback.id).toBe(id);
  });

  it('returns 401 without a token', async () => {
    const id = await createFeedbackId();
    const response = await GET(new Request(createDetailUrl(id)), createContext(id));

    expect(response.status).toBe(401);
  });

  it('returns 404 feedback_not_found for an unknown id', async () => {
    const request = new Request(createDetailUrl('missing-id'), { headers: { authorization: ADMIN_AUTHORIZATION } });
    const response = await GET(request, createContext('missing-id'));
    const body = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('feedback_not_found');
  });

  it('isolates projects: another projectKey cannot read the item', async () => {
    const id = await createFeedbackId();
    const request = new Request(createDetailUrl(id, 'other'), { headers: { authorization: ADMIN_AUTHORIZATION } });
    const response = await GET(request, createContext(id));

    expect(response.status).toBe(404);
    expect(await getFeedbackRepository().find('other', id)).toBeNull();
    expect(await getFeedbackRepository().find('demo', id)).not.toBeNull();
  });
});

describe('PATCH /api/feedback/[id]', () => {
  it('updates status and adminReply', async () => {
    const id = await createFeedbackId();
    const request = createJsonRequest(
      createDetailUrl(id),
      'PATCH',
      { status: 'resolved', adminReply: 'Fixed in the next release.' },
      { authorization: ADMIN_AUTHORIZATION },
    );
    const response = await PATCH(request, createContext(id));
    const body = (await response.json()) as FeedbackDetailResponse;

    expect(response.status).toBe(200);
    expect(body.feedback.status).toBe('resolved');
    expect(body.feedback.adminReply).toBe('Fixed in the next release.');

    const stored = await getFeedbackRepository().find('demo', id);
    expect(stored?.status).toBe('resolved');
  });

  it('returns 401 without a token', async () => {
    const id = await createFeedbackId();
    const response = await PATCH(
      createJsonRequest(createDetailUrl(id), 'PATCH', { status: 'resolved' }),
      createContext(id),
    );

    expect(response.status).toBe(401);
  });

  it('links a duplicate to its original and drops the link when the status changes again', async () => {
    const originalId = await createStoredFeedbackId();
    const id = await createStoredFeedbackId();
    const patchFeedback = async (changes: unknown) => {
      const request = createJsonRequest(createDetailUrl(id), 'PATCH', changes, { authorization: ADMIN_AUTHORIZATION });
      const response = await PATCH(request, createContext(id));
      return (await response.json()) as FeedbackDetailResponse;
    };

    const marked = await patchFeedback({ status: 'duplicate', duplicateOfId: originalId });
    const replied = await patchFeedback({ adminReply: 'Same as an earlier report.' });
    const rejected = await patchFeedback({ status: 'rejected' });

    expect(marked.feedback).toMatchObject({ status: 'duplicate', duplicateOfId: originalId });
    expect(replied.feedback).toMatchObject({ status: 'duplicate', duplicateOfId: originalId });
    expect(rejected.feedback).toMatchObject({ status: 'rejected', duplicateOfId: null });
  });

  it('returns 400 invalid_duplicate_target unless the original is another feedback of the project that is not a duplicate', async () => {
    const repository = getFeedbackRepository();
    const id = await createStoredFeedbackId();
    const originalId = await createStoredFeedbackId();
    const duplicateId = await createStoredFeedbackId();
    const otherProjectId = await createStoredFeedbackId('other');
    await repository.update('demo', duplicateId, { status: 'duplicate', duplicateOfId: originalId });

    for (const duplicateOfId of [id, crypto.randomUUID(), otherProjectId, duplicateId]) {
      const request = createJsonRequest(
        createDetailUrl(id),
        'PATCH',
        { status: 'duplicate', duplicateOfId },
        { authorization: ADMIN_AUTHORIZATION },
      );
      const response = await PATCH(request, createContext(id));
      const body = (await response.json()) as ApiErrorResponse;

      expect(response.status).toBe(400);
      expect(body.error.code).toBe('invalid_duplicate_target');
    }
    expect(await repository.find('demo', id)).toMatchObject({ status: 'open', duplicateOfId: null });
  });

  it('returns 400 invalid_body for an invalid status', async () => {
    const id = await createFeedbackId();
    const request = createJsonRequest(
      createDetailUrl(id),
      'PATCH',
      { status: 'archived' },
      { authorization: ADMIN_AUTHORIZATION },
    );
    const response = await PATCH(request, createContext(id));
    const body = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('invalid_body');
  });

  it('returns 404 when the item does not exist', async () => {
    const request = createJsonRequest(
      createDetailUrl('missing-id'),
      'PATCH',
      { status: 'resolved' },
      { authorization: ADMIN_AUTHORIZATION },
    );
    const response = await PATCH(request, createContext('missing-id'));

    expect(response.status).toBe(404);
  });
});
