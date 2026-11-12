import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET as GET_DETAIL, PATCH } from '@/app/api/feedback/[id]/route';
import { ADMIN_AUTHORIZATION, createFeedbackBody, createJsonRequest } from '@/app/api/feedback/feedback-test-fixtures';
import { GET, POST } from '@/app/api/feedback/route';
import { resetRateLimit } from '@/lib/http/rate-limit';

const COLLECTION_URL = 'http://localhost:3000/api/feedback';
const DETAIL_URL = `${COLLECTION_URL}/00000000-0000-4000-8000-000000000001?projectKey=demo`;
const CONTEXT = { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }) };
const ADMIN_HEADERS = { authorization: ADMIN_AUTHORIZATION };

beforeEach(() => {
  vi.stubEnv('FEEDBACK_STORAGE', 'supabase');
  vi.stubEnv('SUPABASE_URL', undefined);
  vi.stubEnv('SUPABASE_SECRET_KEY', undefined);
  resetRateLimit();
});

afterEach(() => vi.unstubAllEnvs());

it.each([
  {
    operation: 'create',
    run: () => POST(createJsonRequest(COLLECTION_URL, 'POST', createFeedbackBody())),
  },
  {
    operation: 'list',
    run: () => GET(new Request(`${COLLECTION_URL}?projectKey=demo`, { headers: ADMIN_HEADERS })),
  },
  {
    operation: 'detail',
    run: () => GET_DETAIL(new Request(DETAIL_URL, { headers: ADMIN_HEADERS }), CONTEXT),
  },
  {
    operation: 'update',
    run: () => PATCH(createJsonRequest(DETAIL_URL, 'PATCH', { status: 'resolved' }, ADMIN_HEADERS), CONTEXT),
  },
])('returns a stable 503 response for $operation when storage is not configured', async ({ run }) => {
  const response = await run();

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: { code: 'storage_unavailable', message: 'Feedback storage is unavailable.' },
  });
});
