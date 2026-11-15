'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { ChatMessage, ChatMessageBubble, ChatMessageMetadata } from '@astryxdesign/core/Chat';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { List, ListItem } from '@astryxdesign/core/List';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { VStack } from '@astryxdesign/core/VStack';
import { z } from 'zod';
import { CONVERSATION_SAVED_EVENT, getBrowserConversationSecrets } from '@/lib/browser-conversations';
import { shouldLoadConversationsNow, shouldPollConversations, startConversationLoader } from '@/lib/conversation-polling';
import { conversationMessagesSchema } from '@/lib/validation/conversation-schema';
import { WIDGET_TEAM_NAME, WidgetBanner, WidgetBody, WidgetFooter, WidgetHeader } from '@/components/widget/WidgetLayout';
import type { FeedbackReporter } from '@/types/feedback';

const threadSchema = z.object({
  id: z.uuid(), status: z.string(), createdAt: z.string(),
  messages: conversationMessagesSchema,
});
const threadsSchema = z.object({ threads: z.array(threadSchema) });
type Thread = z.infer<typeof threadSchema>;
type MessageRole = Thread['messages'][number]['authorRole'];
const VERIFICATION_REQUIRED_MESSAGE = '로그인한 사용자만 대화를 볼 수 있어요. 로그인 후 다시 열어 주세요.';
const LOADING_MESSAGE = '대화를 불러오는 중이에요…';
const NEW_FEEDBACK_TAB = 'new';
const HISTORY_TAB = 'history';
const MAX_FOLLOW_UP_LENGTH = 5000;
const MAX_THREAD_MESSAGES = 100;
const LOADING_ROW_WIDTHS = ['80%', '60%', '70%'];

function subscribeToVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}
const getIsVisible = () => document.visibilityState === 'visible';
const getServerIsVisible = () => true;
const ROLE_LABELS = { reporter: '나', admin: '담당자', sdk: 'SDK 관찰', ai: 'AI 생성' } as const;

// The reporter's own messages sit on the trailing side; everything written for them on the leading side.
function getChatSender(role: MessageRole): 'user' | 'assistant' {
  return role === 'reporter' ? 'user' : 'assistant';
}

interface ConversationPanelProps {
  config: { projectKey: string; hostOrigin: string };
  reporter: FeedbackReporter | null;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function ConversationPanel({ config, reporter, isOpen, onClose, children }: ConversationPanelProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [result, setResult] = useState<{ owner: string; threads: Thread[]; error: string; verificationRequired?: boolean } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const isVisible = useSyncExternalStore(subscribeToVisibility, getIsVisible, getServerIsVisible);
  const polling = shouldPollConversations({ isOpen, showHistory, isVisible });
  const previousLoaderRun = useRef<{ inputs: readonly unknown[]; polling: boolean } | null>(null);
  const identityKey = JSON.stringify(reporter);
  // A result is shown only to the reporter it was loaded for, so a user switch never displays the previous
  // user's threads, even for a moment or through a response that was already in flight.
  const owner = JSON.stringify(reporter?.id ?? null);
  const current = result?.owner === owner ? result : null;
  const threads = current?.threads ?? [];
  const error = current?.error ?? '';
  const verificationRequired = current?.verificationRequired === true;
  const loading = current === null;
  const selected = threads.find((thread) => thread.id === selectedId);
  const draft = selectedId ? drafts[selectedId] ?? '' : '';

  function getRequest() {
    return {
      ...config,
      reporter: reporter ? { id: reporter.id, name: reporter.name, organization: reporter.organization, identity: reporter.identity } : null,
      secrets: getBrowserConversationSecrets(config.projectKey, config.hostOrigin, reporter?.id ?? null),
    };
  }

  useEffect(() => {
    const saved = () => setRefresh((value) => value + 1);
    window.addEventListener(CONVERSATION_SAVED_EVENT, saved);
    return () => window.removeEventListener(CONVERSATION_SAVED_EVENT, saved);
  }, []);

  useEffect(() => {
    const inputs = [config, identityKey, owner, reporter, isOpen, refresh];
    const loadNow = shouldLoadConversationsNow(previousLoaderRun.current, { inputs, polling });
    previousLoaderRun.current = { inputs, polling };
    if (!isOpen) return;
    async function load(signal: AbortSignal) {
      try {
        const response = await fetch('/api/conversations', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...config,
            reporter: reporter ? { id: reporter.id, name: reporter.name, organization: reporter.organization, identity: reporter.identity } : null,
            secrets: getBrowserConversationSecrets(config.projectKey, config.hostOrigin, reporter?.id ?? null),
          }),
          signal,
        });
        if (response.status === 401) {
          if (!signal.aborted) setResult({ owner, threads: [], error: '', verificationRequired: true });
          return;
        }
        if (!response.ok) throw new Error('대화를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
        const loaded = threadsSchema.parse(await response.json());
        if (!signal.aborted) setResult({ owner, threads: loaded.threads, error: '' });
      } catch (failure) {
        if (!signal.aborted) {
          const message = failure instanceof Error ? failure.message : '대화를 불러오지 못했어요.';
          setResult((previous) => ({ owner, threads: previous?.owner === owner ? previous.threads : [], error: message }));
        }
      }
    }
    const stop = startConversationLoader({ load, loadNow, poll: polling });
    // A request cut short (a Strict Mode replay, or leaving the tab mid-load) is loaded again by the next run.
    return () => {
      if (stop()) previousLoaderRun.current = null;
    };
  }, [config, identityKey, owner, reporter, isOpen, refresh, polling]);

  async function send() {
    if (!selected || !draft.trim() || sending) return;
    const id = selected.id;
    setSending(true);
    try {
      const response = await fetch('/api/conversations', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...getRequest(), feedbackId: id, message: draft.trim() }),
      });
      if (response.status === 401) throw new Error(VERIFICATION_REQUIRED_MESSAGE);
      if (!response.ok) throw new Error('보내지 못했어요. 대화가 가득 찼거나 연결이 끊겼을 수 있어요.');
      const sent = z.object({ thread: threadSchema }).parse(await response.json());
      setResult((previous) => previous?.owner === owner
        ? { owner, threads: previous.threads.map((item) => item.id === id ? sent.thread : item), error: '' }
        : previous);
      setDrafts((values) => ({ ...values, [id]: '' }));
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '보내지 못했어요.';
      setResult((previous) => previous?.owner === owner ? { ...previous, error: message } : previous);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <TabList
        value={showHistory ? HISTORY_TAB : NEW_FEEDBACK_TAB}
        onChange={(value) => setShowHistory(value === HISTORY_TAB)}
        size="lg"
        layout="fill"
        hasDivider
        aria-label="피드백 메뉴"
        className="shrink-0"
      >
        <Tab value={NEW_FEEDBACK_TAB} label="새 피드백" />
        <Tab value={HISTORY_TAB} label={`내 대화 ${threads.length}`} />
      </TabList>
      {!showHistory ? children : (
        <>
          <WidgetHeader
            title="내 대화"
            subtitle="이 브라우저의 대화와 인증된 계정의 대화"
            onClose={onClose}
            onBack={selected ? () => setSelectedId(null) : undefined}
            backLabel="대화 목록으로"
          />
          <WidgetBody>
            {error ? <WidgetBanner tone="danger" isAlert>{error}</WidgetBanner> : null}
            {loading ? (
              <div role="status">
                <span className="sr-only">{LOADING_MESSAGE}</span>
                <VStack gap={3}>
                  {LOADING_ROW_WIDTHS.map((width, index) => <Skeleton key={width} height={16} width={width} index={index} />)}
                </VStack>
              </div>
            ) : null}
            {verificationRequired ? <WidgetBanner tone="warning">{VERIFICATION_REQUIRED_MESSAGE}</WidgetBanner> : null}
            {!loading && !verificationRequired && threads.length === 0 ? (
              <EmptyState isCompact title="아직 대화가 없어요" description="새 피드백을 보내 주세요." />
            ) : null}
            {selected ? (
              <ol aria-label="대화 내역" className="flex flex-col gap-4">
                {selected.messages.map((message) => (
                  <li key={message.id} className="min-w-0">
                    <ChatMessage
                      sender={getChatSender(message.authorRole)}
                      name={ROLE_LABELS[message.authorRole]}
                      avatar={message.authorRole === 'admin' ? <Avatar name={WIDGET_TEAM_NAME} size="sm" tooltip={false} /> : undefined}
                    >
                      <ChatMessageBubble metadata={<ChatMessageMetadata timestamp={<Timestamp value={message.createdAt} />} />}>
                        <span className="whitespace-pre-wrap">{message.body}</span>
                      </ChatMessageBubble>
                    </ChatMessage>
                  </li>
                ))}
              </ol>
            ) : (
              <List hasDividers density="spacious">
                {threads.map((thread) => (
                  <ListItem
                    key={thread.id}
                    label={<Text maxLines={2}>{thread.messages[0]?.body}</Text>}
                    description={`메시지 ${thread.messages.length}개`}
                    endContent={<Icon icon="chevronRight" color="secondary" />}
                    onClick={() => setSelectedId(thread.id)}
                  />
                ))}
              </List>
            )}
          </WidgetBody>
          {selected ? (
            <WidgetFooter>
              <TextArea
                id="conversation-followup"
                label="추가 메시지"
                value={draft}
                htmlMaxLength={MAX_FOLLOW_UP_LENGTH}
                rows={3}
                isDisabled={sending}
                onChange={(value) => setDrafts((values) => ({ ...values, [selected.id]: value }))}
              />
              <Button
                label="메시지 보내기"
                variant="primary"
                size="lg"
                width="100%"
                isLoading={sending}
                isDisabled={!draft.trim() || selected.messages.length >= MAX_THREAD_MESSAGES}
                onClick={() => void send()}
              />
            </WidgetFooter>
          ) : null}
        </>
      )}
    </>
  );
}
