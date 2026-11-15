import { expect, it } from 'vitest';

import { createScriptLiteralReader } from '@/sdk/automatic-masking';
import { readTextWithinBudget } from '@/sdk/bounded-source';

function createReader(chunks: (string | Error)[]) {
  const queue = [...chunks];
  return {
    read: async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
      const next = queue.shift();
      if (next === undefined) return { done: true, value: undefined };
      if (next instanceof Error) throw next;
      return { done: false, value: new TextEncoder().encode(next) };
    },
  };
}

it('reads a source that fits the budget completely', async () => {
  const source = await readTextWithinBudget(createReader(['const a = "Orders";', ' const b = "Save";']), 1024);

  expect(source).toEqual({ text: 'const a = "Orders"; const b = "Save";', byteLength: 37, isComplete: true });
});

it('keeps the labels read before the budget ran out instead of dropping the whole source', async () => {
  const source = await readTextWithinBudget(createReader(['const a = "Orders"; const b = "Sa', 've"; const c = "Cancel";']), 30);

  expect(source.isComplete).toBe(false);
  expect(source.byteLength).toBe(30);
  expect(createScriptLiteralReader(source.text)(Infinity)).toEqual(['Orders']);
});

it('does not turn a character cut at the budget into a different one', async () => {
  const source = await readTextWithinBudget(createReader(['"주문"']), 5);

  expect(source.text).toBe('"주');
  expect(source.isComplete).toBe(false);
});

it('keeps what arrived when the download stops', async () => {
  const source = await readTextWithinBudget(createReader(['const a = "Orders";', new Error('aborted')]), 1024);

  expect(source.isComplete).toBe(false);
  expect(createScriptLiteralReader(source.text)(Infinity)).toEqual(['Orders']);
});

it('reads nothing once the budget is used up', async () => {
  expect(await readTextWithinBudget(createReader(['const a = "Orders";']), 0)).toEqual({ text: '', byteLength: 0, isComplete: false });
});
