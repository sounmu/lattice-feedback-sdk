import { beforeEach, expect, it } from 'vitest';
import { GET } from '@/app/api/feedback/route';
import { GET as getDetail } from '@/app/api/feedback/[id]/route';
import { ADMIN_AUTHORIZATION, createFeedbackBody } from '@/app/api/feedback/feedback-test-fixtures';
import { getFeedbackRepository } from '@/lib/feedback-repository';
import { resetMemoryFeedbackStore } from '@/lib/memory-feedback-repository';
import { createFeedbackInputSchema } from '@/lib/validation/feedback-schema';

const URL = 'http://localhost:3000/api/feedback?projectKey=demo';
const HEADERS = { authorization: ADMIN_AUTHORIZATION };

beforeEach(() => {
  resetMemoryFeedbackStore();
});

it('omits conversation history from the list while keeping list fields and the full detail', async () => {
  const repository = getFeedbackRepository();
  const created = await repository.create(createFeedbackInputSchema.parse(createFeedbackBody()));
  await repository.update('demo', created.id, { adminReply: 'First answer' });
  const updated = await repository.update('demo', created.id, { adminReply: 'Second answer' });
  const expected = { ...updated };
  delete expected.messages;

  const response = await GET(new Request(URL, { headers: HEADERS }));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ items: [expected] });
  const detail = await getDetail(
    new Request(`http://localhost:3000/api/feedback/${created.id}?projectKey=demo`, { headers: HEADERS }),
    { params: Promise.resolve({ id: created.id }) },
  );
  expect(await detail.json()).toMatchObject({
    feedback: { messages: [{ body: 'First answer' }, { body: 'Second answer' }] },
  });
});
