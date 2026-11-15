import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONVERSATION_POLL_INTERVAL_MS,
  shouldLoadConversationsNow,
  shouldPollConversations,
  startConversationLoader,
} from '@/lib/conversation-polling';

describe('shouldPollConversations', () => {
  it('polls only while the widget is open, on the conversation tab, and the page is visible', () => {
    expect(shouldPollConversations({ isOpen: true, showHistory: true, isVisible: true })).toBe(true);
    expect(shouldPollConversations({ isOpen: true, showHistory: false, isVisible: true })).toBe(false);
    expect(shouldPollConversations({ isOpen: true, showHistory: true, isVisible: false })).toBe(false);
    expect(shouldPollConversations({ isOpen: false, showHistory: true, isVisible: true })).toBe(false);
  });
});

describe('shouldLoadConversationsNow', () => {
  const inputs = ['config', 'identity', 'owner'];

  it('loads on the first run and when an input changes', () => {
    expect(shouldLoadConversationsNow(null, { inputs, polling: false })).toBe(true);
    expect(shouldLoadConversationsNow({ inputs, polling: false }, { inputs: ['config', 'identity', 'other'], polling: false })).toBe(true);
  });

  it('loads when polling starts, but stays quiet when polling stops', () => {
    expect(shouldLoadConversationsNow({ inputs, polling: false }, { inputs, polling: true })).toBe(true);
    expect(shouldLoadConversationsNow({ inputs, polling: true }, { inputs, polling: false })).toBe(false);
    expect(shouldLoadConversationsNow({ inputs, polling: true }, { inputs, polling: true })).toBe(false);
  });
});

describe('startConversationLoader', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('loads once and never schedules a timer when not polling', async () => {
    const load = vi.fn(async () => {});
    startConversationLoader({ load, loadNow: true, poll: false });
    await vi.advanceTimersByTimeAsync(CONVERSATION_POLL_INTERVAL_MS * 5);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('loads immediately and then every interval while polling', async () => {
    const load = vi.fn(async () => {});
    startConversationLoader({ load, loadNow: true, poll: true });
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CONVERSATION_POLL_INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(CONVERSATION_POLL_INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('makes no request when polling stops without a reason to load', async () => {
    const load = vi.fn(async () => {});
    startConversationLoader({ load, loadNow: false, poll: false });
    await vi.advanceTimersByTimeAsync(CONVERSATION_POLL_INTERVAL_MS * 3);
    expect(load).not.toHaveBeenCalled();
  });

  it('aborts the in-flight request and clears the timer on cleanup', async () => {
    let signal: AbortSignal | undefined;
    const load = vi.fn(async (received: AbortSignal) => { signal = received; });
    const stop = startConversationLoader({ load, loadNow: true, poll: true });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(CONVERSATION_POLL_INTERVAL_MS * 3);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reports a request that cleanup cut short, so the next run loads again', async () => {
    let finish: () => void = () => {};
    const load = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const interrupted = startConversationLoader({ load, loadNow: true, poll: false });
    expect(interrupted()).toBe(true);
    finish();

    const completed = startConversationLoader({ load: vi.fn(async () => {}), loadNow: true, poll: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(completed()).toBe(false);
  });

  it('does not reschedule after cleanup while a request is still pending', async () => {
    let finish: () => void = () => {};
    const load = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const stop = startConversationLoader({ load, loadNow: true, poll: true });
    stop();
    finish();
    await vi.advanceTimersByTimeAsync(CONVERSATION_POLL_INTERVAL_MS * 3);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
