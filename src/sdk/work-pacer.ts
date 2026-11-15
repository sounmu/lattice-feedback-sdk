// Long work on the host page is done in slices. A task that keeps the main thread for more than a few frames
// makes the page stutter under the reporter's hands, and one over 50 ms counts as a long task.

const SLICE_MS = 8;

interface YieldingScheduler {
  yield(): Promise<void>;
}

function isYieldingScheduler(value: unknown): value is YieldingScheduler {
  return typeof value === 'object' && value !== null && 'yield' in value && typeof value.yield === 'function';
}

function yieldToPage(): Promise<void> {
  const scheduler: unknown = Reflect.get(globalThis, 'scheduler');
  // scheduler.yield() resumes ahead of other queued work once input and rendering have had their turn.
  if (isYieldingScheduler(scheduler)) return scheduler.yield();
  // A message is not held back the way a timer is, least of all in a background tab.
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      resolve();
    };
    port2.postMessage(null);
  });
}

/**
 * A function to await between pieces of long work. It resolves at once while the current slice of time lasts,
 * and lets the page run first once the slice is used up.
 */
export function createWorkPacer(): () => Promise<void> {
  let sliceStart = performance.now();
  return async () => {
    if (performance.now() - sliceStart < SLICE_MS) return;
    await yieldToPage();
    sliceStart = performance.now();
  };
}
