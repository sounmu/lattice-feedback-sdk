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
