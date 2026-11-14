'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { CONVERSATION_SAVED_EVENT, getBrowserConversationSecrets } from '@/lib/browser-conversations';
import { conversationMessagesSchema } from '@/lib/validation/conversation-schema';
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS, WidgetBody, WidgetFooter, WidgetHeader } from '@/components/widget/WidgetLayout';
import type { FeedbackReporter } from '@/types/feedback';

const threadSchema = z.object({
  id: z.uuid(), status: z.string(), createdAt: z.string(),
  messages: conversationMessagesSchema,
});
const threadsSchema = z.object({ threads: z.array(threadSchema) });
type Thread = z.infer<typeof threadSchema>;
const ROLE_LABELS = { reporter: '나', admin: '담당자', sdk: 'SDK 관찰', ai: 'AI 생성' } as const;

interface ConversationPanelProps {
  config: { projectKey: string; hostOrigin: string };
  reporter: FeedbackReporter | null;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function ConversationPanel({ config, reporter, isOpen, onClose, children }: ConversationPanelProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const identityKey = JSON.stringify(reporter);
  const selected = threads.find((thread) => thread.id === selectedId);
  const draft = selectedId ? drafts[selectedId] ?? '' : '';

  function getRequest() {
    return {
      ...config,
      reporter: reporter ? { id: reporter.id, name: reporter.name, identity: reporter.identity } : null,
      secrets: getBrowserConversationSecrets(config.projectKey, config.hostOrigin),
    };
  }

  useEffect(() => {
    const saved = () => setRefresh((value) => value + 1);
    window.addEventListener(CONVERSATION_SAVED_EVENT, saved);
    return () => window.removeEventListener(CONVERSATION_SAVED_EVENT, saved);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch('/api/conversations', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...config,
            reporter: reporter ? { id: reporter.id, name: reporter.name, identity: reporter.identity } : null,
            secrets: getBrowserConversationSecrets(config.projectKey, config.hostOrigin),
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('대화를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
        const result = threadsSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setThreads(result.threads);
          setError('');
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '대화를 불러오지 못했어요.');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = setTimeout(load, 10_000);
        }
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [config, identityKey, reporter, isOpen, refresh]);

  async function send() {
    if (!selected || !draft.trim() || sending) return;
    const id = selected.id;
    setSending(true);
    try {
      const response = await fetch('/api/conversations', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...getRequest(), feedbackId: id, message: draft.trim() }),
      });
      if (!response.ok) throw new Error('보내지 못했어요. 대화가 가득 찼거나 연결이 끊겼을 수 있어요.');
      const result = z.object({ thread: threadSchema }).parse(await response.json());
      setThreads((items) => items.map((item) => item.id === id ? result.thread : item));
      setDrafts((values) => ({ ...values, [id]: '' }));
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '보내지 못했어요.');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <nav aria-label="피드백 메뉴" className="flex shrink-0 gap-2 border-b border-fw-border p-2">
        <button type="button" className={SECONDARY_BUTTON_CLASS} aria-pressed={!showHistory} onClick={() => setShowHistory(false)}>새 피드백</button>
        <button type="button" className={SECONDARY_BUTTON_CLASS} aria-pressed={showHistory} onClick={() => setShowHistory(true)}>내 대화 {threads.length}</button>
      </nav>
      {!showHistory ? children : (
        <>
          <WidgetHeader title="내 대화" subtitle="이 브라우저의 대화와 인증된 계정의 대화" onClose={onClose} />
          <WidgetBody>
            {error ? <p role="alert" className="text-fw-danger">{error}</p> : null}
            {loading ? <p role="status">대화를 불러오는 중이에요…</p> : null}
            {!loading && threads.length === 0 ? <p>아직 대화가 없어요. 새 피드백을 보내 주세요.</p> : null}
            {selected ? (
              <>
                <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={() => setSelectedId(null)}>대화 목록으로</button>
                <ol aria-label="대화 내역" className="flex flex-col gap-4">
                  {selected.messages.map((message) => (
                    <li key={message.id} className="min-w-0 border-b border-fw-border pb-3">
                      <p className="font-semibold">{ROLE_LABELS[message.authorRole]}</p>
                      <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.body}</p>
                      <time dateTime={message.createdAt} className="text-xs text-fw-sub">{new Date(message.createdAt).toLocaleString()}</time>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <ul className="flex flex-col gap-2">
                {threads.map((thread) => (
                  <li key={thread.id}>
                    <button type="button" className="min-h-11 w-full rounded-xl border border-fw-border p-3 text-left hover:bg-fw-surface focus-visible:outline-2 focus-visible:outline-fw-primary" onClick={() => setSelectedId(thread.id)}>
                      <span className="line-clamp-2 [overflow-wrap:anywhere]">{thread.messages[0]?.body}</span>
                      <span className="text-xs text-fw-sub">메시지 {thread.messages.length}개</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </WidgetBody>
          {selected ? (
            <WidgetFooter>
              <label htmlFor="conversation-followup" className="font-semibold">추가 메시지</label>
              <textarea id="conversation-followup" value={draft} maxLength={5000} rows={3} disabled={sending}
                onChange={(event) => setDrafts((values) => ({ ...values, [selected.id]: event.target.value }))}
                className="w-full resize-none rounded-xl border border-fw-border p-3 focus-visible:outline-2 focus-visible:outline-fw-primary" />
              <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={sending || !draft.trim() || selected.messages.length >= 100} onClick={() => void send()}>
                {sending ? '보내는 중…' : '메시지 보내기'}
              </button>
            </WidgetFooter>
          ) : null}
        </>
      )}
    </>
  );
}
