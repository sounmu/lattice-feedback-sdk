export const CONVERSATION_POLL_INTERVAL_MS = 10_000;

interface PollingScope {
  isOpen: boolean;
  showHistory: boolean;
  isVisible: boolean;
}

export function shouldPollConversations({ isOpen, showHistory, isVisible }: PollingScope): boolean {
  return isOpen && showHistory && isVisible;
}

interface LoaderRun {
  inputs: readonly unknown[];
  polling: boolean;
}

// Turning polling off alone must not trigger a request: that is the tab switch / page hide we want to stay quiet for.
export function shouldLoadConversationsNow(previous: LoaderRun | null, next: LoaderRun): boolean {
  if (!previous) return true;
  if (next.polling && !previous.polling) return true;
  if (previous.inputs.length !== next.inputs.length) return true;
  return next.inputs.some((value, index) => !Object.is(value, previous.inputs[index]));
}

interface ConversationLoaderOptions {
  load: (signal: AbortSignal) => Promise<void>;
  loadNow: boolean;
  poll: boolean;
}

export function startConversationLoader({ load, loadNow, poll }: ConversationLoaderOptions): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function run() {
    try {
      await load(controller.signal);
    } finally {
      if (poll && !controller.signal.aborted) timer = setTimeout(run, CONVERSATION_POLL_INTERVAL_MS);
    }
  }
  if (loadNow) void run();
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
