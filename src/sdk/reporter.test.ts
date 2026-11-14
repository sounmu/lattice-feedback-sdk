import { expect, it } from 'vitest';
import { copyReporter, isFeedbackReporter } from '@/sdk/reporter';

it.each([null, [], { id: 1, name: 'Test' }, { id: 'test' }, { id: 'test', name: 'Test', email: 123 }])(
  'rejects malformed reporter data: %j',
  (value) => expect(isFeedbackReporter(value)).toBe(false),
);

it('copies only supported reporter fields and isolates later host mutation', () => {
  const reporter = { id: 'test', name: 'Test', email: 'test@example.com', token: 'private-value' };
  const copied = copyReporter(reporter);
  reporter.name = 'Changed';

  expect(copied).toEqual({ id: 'test', name: 'Test', email: 'test@example.com' });
});

it('passes a valid identity proof without retaining a mutable host reference', () => {
  const reporter = { id: 'alice', name: 'Alice', identity: { expiresAt: 1800000000, signature: 'a'.repeat(64) } };
  expect(isFeedbackReporter(reporter)).toBe(true);
  const copied = copyReporter(reporter);
  reporter.identity.signature = 'b'.repeat(64);
  expect(copied.identity).toEqual({ expiresAt: 1800000000, signature: 'a'.repeat(64) });
});

it.each([null, 'proof', { expiresAt: '1800000000', signature: 'a'.repeat(64) }, { expiresAt: 1800000000, signature: 'bad' }])(
  'rejects a malformed identity proof before postMessage', (identity) => {
    expect(isFeedbackReporter({ id: 'alice', name: 'Alice', identity })).toBe(false);
  },
);
