import { beforeEach, expect, it } from 'vitest';
import { POST as create } from '@/app/api/feedback/route';
import { PATCH } from '@/app/api/feedback/[id]/route';
import { POST as poll, PUT as followup } from '@/app/api/conversations/route';
import { ADMIN_AUTHORIZATION } from '@/app/api/feedback/feedback-test-fixtures';
import { resetRateLimit } from '@/lib/http/rate-limit';

const BASE = 'http://localhost:3000/api';
const CONTEXT = { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }) };
const ROUTES = [
  { name: 'feedback', url: `${BASE}/feedback`, method: 'POST', limit: 65536, run: create },
  { name: 'admin update', url: `${BASE}/feedback/00000000-0000-4000-8000-000000000001?projectKey=demo`, method: 'PATCH', limit: 32768, run: PATCH },
  { name: 'polling', url: `${BASE}/conversations`, method: 'POST', limit: 32768, run: poll },
  { name: 'followup', url: `${BASE}/conversations`, method: 'PUT', limit: 32768, run: followup },
] as const;

beforeEach(() => resetRateLimit());

it.each(ROUTES)('rejects declared oversized $name bodies before consuming them', async ({ url, method, limit, run }) => {
  const request = new Request(url, {
    method,
    headers: {
      authorization: ADMIN_AUTHORIZATION,
      'sec-fetch-site': 'same-origin',
      'content-length': String(limit + 1),
    },
    body: ' '.repeat(limit + 1),
  });

  const response = await run(request, CONTEXT);

  expect(response.status).toBe(413);
  expect(request.bodyUsed).toBe(false);
});

it.each(ROUTES)('still bounds streamed $name bodies when content-length understates their size', async ({ url, method, limit, run }) => {
  const request = new Request(url, {
    method,
    headers: {
      authorization: ADMIN_AUTHORIZATION,
      'sec-fetch-site': 'same-origin',
      'content-length': '1',
    },
    body: ' '.repeat(limit + 1),
  });

  const response = await run(request, CONTEXT);

  expect(response.status).toBe(413);
});
