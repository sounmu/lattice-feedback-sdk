'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { ChatMessage, ChatMessageBubble } from '@astryxdesign/core/Chat';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Kbd } from '@astryxdesign/core/Kbd';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { VStack } from '@astryxdesign/core/VStack';

import { useHostBridge } from '@/hooks/useHostBridge';
import { ConversationPanel } from '@/components/widget/ConversationPanel';
import { ANONYMOUS_REPORTER_ID } from '@/lib/conversation';
import { rememberConversationSecret } from '@/lib/browser-conversations';
import { useScreenSnapshots, type ScreenSaveStatus } from '@/hooks/useScreenSnapshots';
import { useSubmitFeedback } from '@/hooks/useSubmitFeedback';
import {
  CaptureAttachmentCards,
  CaptureModeView,
  CaptureToolBar,
  countAttachments,
} from '@/components/widget/CaptureControls';
import { ScreenSnapshotControls } from '@/components/widget/ScreenSnapshotControls';
import { SendIcon } from '@/components/widget/WidgetIcons';
import {
  WIDGET_TEAM_NAME,
  WidgetBanner,
  WidgetBody,
  WidgetFooter,
  WidgetHeader,
} from '@/components/widget/WidgetLayout';
import { findAttachmentChange, type AttachmentChange, type AttachmentCounts } from '@/lib/attachment-notice';
import { createCaptureCommand } from '@/lib/capture-protocol';
import type { FeedbackReporter, FeedbackType } from '@/types/feedback';
import type { CaptureState } from '@/types/sdk-message';

const MAX_MESSAGE_LENGTH = 5000;
const ATTACHMENT_NOTICE_MS = 4000;

const ANONYMOUS_REPORTER: FeedbackReporter = { id: ANONYMOUS_REPORTER_ID, name: 'Anonymous' };

const FEEDBACK_TYPE_OPTIONS: { value: FeedbackType; label: string }[] = [
  { value: 'bug', label: '버그' },
  { value: 'improvement', label: '개선 제안' },
  { value: 'question', label: '질문' },
  { value: 'other', label: '기타' },
];

const WIDGET_TITLE = '피드백 보내기';
const REPLY_NOTICE = '보통 1영업일 안에 답변드려요';
const MESSAGE_LABEL = '피드백 내용';
const SEND_LABEL = '보내기';
const SCREEN_TOOL_TITLE = '지금 보고 있는 화면을 그대로 저장해 함께 보내요. 비밀번호 입력값은 저장하지 않아요.';
const FLOW_TRUNCATED_MESSAGE = '기록이 너무 길었거나 저장할 수 없는 페이지로 이동해서, 뒷부분은 재생에서 빠졌어요.';
const SUBMIT_RETRY_MESSAGE = '잠시 후 다시 시도해 주세요. 작성한 내용은 그대로 남아 있어요.';
const SUBMIT_RETRY_HINT = '작성한 내용은 그대로 남아 있어요. 보내기를 다시 눌러 주세요.';
const LOADING_LINE_WIDTHS = ['80%', '60%', '66%'];

const SCREEN_PROGRESS_MESSAGES: Record<Exclude<ScreenSaveStatus, 'idle'>, string> = {
  capturing: '화면을 저장하는 중이에요…',
  uploading: '저장한 화면을 올리는 중이에요…',
};

const ATTACHMENT_NOTICES: Record<AttachmentChange['kind'], Record<AttachmentChange['direction'], string>> = {
  comment: { added: '코멘트를 첨부했어요', removed: '코멘트를 지웠어요' },
  edit: { added: '위치 편집을 첨부했어요', removed: '위치 편집을 지웠어요' },
  flow: { added: '흐름 기록을 첨부했어요', removed: '흐름 기록을 지웠어요' },
  screen: { added: '화면을 저장했어요', removed: '저장한 화면을 지웠어요' },
};

const EMPTY_COUNTS: AttachmentCounts = { comments: 0, edits: 0, flows: 0, screens: 0 };

interface SubmittedSummary {
  typeLabel: string;
  pageTitle: string;
  attachments: string;
}

function getTypeLabel(type: FeedbackType): string {
  return FEEDBACK_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

function getAttachmentSummary(attachments: CaptureState['attachments'] | undefined, screenCount: number): string {
  const parts: string[] = [];
  if (attachments && attachments.comments.length > 0) {
    parts.push(`코멘트 ${attachments.comments.length}`);
  }
  if (attachments && attachments.edits.length > 0) {
    parts.push(`위치 편집 ${attachments.edits.length}`);
  }
  if (attachments?.flow) {
    parts.push('흐름 기록');
  }
  if (screenCount > 0) {
    parts.push(`화면 ${screenCount}`);
  }
  return parts.length > 0 ? parts.join(' · ') : '없음';
}

function getSubtitle(reporter: FeedbackReporter | null): string {
  return reporter ? `${reporter.name} 님 · ${REPLY_NOTICE}` : REPLY_NOTICE;
}

function getAttachmentCounts(attachments: CaptureState['attachments'] | null, screenCount: number): AttachmentCounts {
  if (!attachments) {
    return { ...EMPTY_COUNTS, screens: screenCount };
  }
  return {
    comments: attachments.comments.length,
    edits: attachments.edits.length,
    flows: attachments.flow ? 1 : 0,
    screens: screenCount,
  };
}

// Moving focus into the composer pops the keyboard on a phone, so it only happens where a pointer and
// keyboard are the norm. Keyboard users on such devices land where they can type right away.
function shouldAutoFocusComposer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function isNothingFocused(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body;
}

export function FeedbackWidget() {
  const {
    config, errorMessage: bridgeErrorMessage, reporter, page, isInitialized, isOpen, notifyClose, notifySubmitted,
    captureState, sendCaptureCommand, subscribeToScreenCapture, subscribeToCaptureUpdate, requestScreenCapture, requestFlowCapture,
  } = useHostBridge();
  const screens = useScreenSnapshots({ config, subscribeToScreenCapture, requestScreenCapture, requestFlowCapture });
  const { syncMarkKeys, captureForMarks, captureFlow } = screens;
  const commentCount = useRef(0);
  const editCount = useRef(0);
  const hasFlow = useRef(false);

  // A comment written on the page or a finished drag arrives as a new comment or edit in the capture
  // state; the screen is saved right away so the admin sees the pin, or the element's original and
  // proposed position, on the screen it was made on.
  useEffect(() => subscribeToCaptureUpdate((state) => {
    // A capture can return before React commits the new state. Update the mark contract in this
    // message callback so reconciliation cannot drop a newly added pin or move as an old one.
    syncMarkKeys({ comments: state.commentKeys ?? [], edits: state.editKeys ?? [] });
    const { comments, edits } = state.attachments;
    if (comments.length > commentCount.current || edits.length > editCount.current) {
      captureForMarks();
    }
    commentCount.current = comments.length;
    editCount.current = edits.length;
    // A newly attached Flow brings a replay of the page, saved as its own screen.
    const flowAttached = state.attachments.flow !== null;
    if (flowAttached && !hasFlow.current) {
      captureFlow();
    }
    hasFlow.current = flowAttached;
  }), [subscribeToCaptureUpdate, syncMarkKeys, captureForMarks, captureFlow]);
  const { submit, reset, status, errorMessage } = useSubmitFeedback();
  const [message, setMessage] = useState('');
  const [type, setType] = useState<FeedbackType>('bug');
  const [submittedSummary, setSubmittedSummary] = useState<SubmittedSummary | null>(null);
  const [attachmentNotice, setAttachmentNotice] = useState<AttachmentChange | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const sendButtonRef = useRef<HTMLButtonElement>(null);
  const attachmentListRef = useRef<HTMLUListElement>(null);
  const previousCounts = useRef<AttachmentCounts | null>(null);
  const noticeRef = useRef<AttachmentChange | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const isResettingDraft = useRef(false);

  const activeMode = captureState?.activeMode ?? null;
  const attachments = captureState?.attachments ?? null;
  const { comments: commentTotal, edits: editTotal, flows: flowTotal, screens: screenTotal } = getAttachmentCounts(attachments, screens.snapshots.length);
  const counts = useMemo<AttachmentCounts>(
    () => ({ comments: commentTotal, edits: editTotal, flows: flowTotal, screens: screenTotal }),
    [commentTotal, editTotal, flowTotal, screenTotal],
  );

  const canSubmit = isInitialized && page !== null && message.trim().length > 0 &&
    status !== 'submitting' && !activeMode && screens.status === 'idle';

  const showAttachmentNotice = useCallback((change: AttachmentChange | null) => {
    if (noticeTimer.current !== null) {
      window.clearTimeout(noticeTimer.current);
      noticeTimer.current = null;
    }
    noticeRef.current = change;
    setAttachmentNotice(change);
    if (change) {
      noticeTimer.current = window.setTimeout(() => {
        noticeTimer.current = null;
        noticeRef.current = null;
        setAttachmentNotice(null);
      }, ATTACHMENT_NOTICE_MS);
    }
  }, []);

  useEffect(() => () => {
    if (noticeTimer.current !== null) {
      window.clearTimeout(noticeTimer.current);
    }
  }, []);

  useEffect(() => {
    const previous = previousCounts.current;
    previousCounts.current = counts;
    const isQuiet = previous === null || status !== 'idle' || isResettingDraft.current;
    if (isResettingDraft.current && Object.values(counts).every((count) => count === 0)) {
      isResettingDraft.current = false;
    }
    if (isQuiet || !previous) {
      return;
    }
    const change = findAttachmentChange(previous, counts);
    if (!change) {
      return;
    }
    // A screen saved for a comment, edit or flow follows the reporter's action by a second or two; it
    // must not talk over the notice for that action.
    const current = noticeRef.current;
    const isSideEffectScreen = change.kind === 'screen' && change.direction === 'added' &&
      current !== null && current.direction === 'added' && current.kind !== 'screen';
    showAttachmentNotice(isSideEffectScreen ? current : change);
    if (change.direction === 'added') {
      const cards = attachmentListRef.current?.querySelectorAll(`li[data-kind="${change.kind}"]`);
      cards?.[cards.length - 1]?.scrollIntoView({ block: 'nearest' });
    }
  }, [counts, status, showAttachmentNotice]);

  // Escape leaves whatever is open: a comment or edit mode, otherwise the panel. A running Flow is
  // never ended by a key the reporter may be pressing for the page itself.
  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) {
        return;
      }
      if (activeMode === 'flow') {
        return;
      }
      event.preventDefault();
      if (activeMode === 'comment' || activeMode === 'edit') {
        sendCaptureCommand(createCaptureCommand({ type: 'capture:cancel', payload: {} }));
        return;
      }
      notifyClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeMode, sendCaptureCommand, notifyClose]);

  useEffect(() => {
    if (!isInitialized || !isNothingFocused()) {
      return;
    }
    if (status === 'error') {
      sendButtonRef.current?.focus({ preventScroll: true });
      return;
    }
    // A view marks the control to land on with data-autofocus. The compose view has no such mark:
    // its message field takes the focus.
    const target = rootRef.current?.querySelector<HTMLElement>('[data-autofocus]') ?? composerRef.current;
    if (!target || (target instanceof HTMLTextAreaElement && !shouldAutoFocusComposer())) {
      return;
    }
    target.focus({ preventScroll: true });
  }, [isInitialized, page, activeMode, status]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config || !page || !canSubmit) {
      return;
    }
    const screenSnapshotIds = screens.snapshots.map((snapshot) => snapshot.id);
    const result = await submit({
      projectKey: config.projectKey,
      hostOrigin: config.hostOrigin,
      message: message.trim(),
      type,
      reporter: reporter ?? ANONYMOUS_REPORTER,
      page,
      attachments: attachments ?? undefined,
      screenSnapshotIds,
    });
    if (result) {
      if (result.conversationSecret) {
        rememberConversationSecret(config.projectKey, config.hostOrigin, reporter?.id ?? null, result.conversationSecret);
      }
      setSubmittedSummary({
        typeLabel: getTypeLabel(type),
        pageTitle: page.title || page.url,
        attachments: getAttachmentSummary(attachments ?? undefined, screenSnapshotIds.length),
      });
      notifySubmitted(result.feedback.id);
    }
  }

  function handleMessageKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function handleTypeChange(value: string) {
    const option = FEEDBACK_TYPE_OPTIONS.find((candidate) => candidate.value === value);
    if (option) {
      setType(option.value);
    }
  }

  function handleWriteAnother() {
    isResettingDraft.current = true;
    showAttachmentNotice(null);
    setMessage('');
    setType('bug');
    setSubmittedSummary(null);
    reset();
    screens.reset();
    sendCaptureCommand(createCaptureCommand({ type: 'draft:reset', payload: {} }));
  }

  function renderUnavailable(reason: string) {
    return (
      <>
        <WidgetHeader title={WIDGET_TITLE} subtitle={REPLY_NOTICE} onClose={notifyClose} />
        <WidgetBody>
          <WidgetBanner tone="danger" title="피드백 창을 열 수 없어요" isAlert>
            페이지를 새로고침해 주세요. 계속 이러면 래티스 담당자에게 알려 주세요.
          </WidgetBanner>
          <Card padding={3}>
            <Text as="p" type="supporting">
              원인(개발자용):{' '}
              <Text type="code" size="sm" color="secondary">
                {reason}
              </Text>
            </Text>
          </Card>
        </WidgetBody>
        <WidgetFooter>
          <Button label="닫기" size="lg" width="100%" onClick={notifyClose} data-autofocus="" />
        </WidgetFooter>
      </>
    );
  }

  function renderSuccess() {
    return (
      <>
        <WidgetHeader title={WIDGET_TITLE} subtitle={getSubtitle(reporter)} onClose={notifyClose} />
        <WidgetBody>
          <div role="status">
            <VStack gap={2} align="center" paddingBlock={6}>
              <span className="flex size-14 items-center justify-center rounded-full bg-(--color-success-muted) text-(--color-on-success-muted)">
                <Icon icon="check" size="lg" />
              </span>
              <Text as="p" type="large">
                피드백이 전달됐어요
              </Text>
              <Text as="p" color="secondary">
                담당자가 확인한 뒤 답변드릴게요.
              </Text>
            </VStack>
          </div>
          {submittedSummary ? (
            <Card padding={3}>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                <dt>
                  <Text color="secondary">유형</Text>
                </dt>
                <dd>
                  <Text>{submittedSummary.typeLabel}</Text>
                </dd>
                <dt>
                  <Text color="secondary">페이지</Text>
                </dt>
                <dd>
                  <Text maxLines={1}>{submittedSummary.pageTitle}</Text>
                </dd>
                <dt>
                  <Text color="secondary">첨부</Text>
                </dt>
                <dd>
                  <Text>{submittedSummary.attachments}</Text>
                </dd>
              </dl>
            </Card>
          ) : null}
        </WidgetBody>
        <WidgetFooter>
          <HStack gap={2}>
            <Button label="닫기" size="lg" width="100%" onClick={notifyClose} />
            <Button label="다른 피드백 작성" variant="primary" size="lg" width="100%" onClick={handleWriteAnother} data-autofocus="" />
          </HStack>
        </WidgetFooter>
      </>
    );
  }

  function renderProgress() {
    if (status === 'submitting') {
      return <WidgetBanner tone="info">보내는 중이에요…</WidgetBanner>;
    }
    if (screens.status !== 'idle') {
      return <WidgetBanner tone="info">{SCREEN_PROGRESS_MESSAGES[screens.status]}</WidgetBanner>;
    }
    return null;
  }

  function renderSubmitError() {
    if (status !== 'error') {
      return null;
    }
    const detail = errorMessage || SUBMIT_RETRY_MESSAGE;
    return (
      <WidgetBanner tone="danger" title="전송하지 못했어요" isAlert>
        <span className="block">{detail}</span>
        {detail !== SUBMIT_RETRY_MESSAGE ? <span className="block">{SUBMIT_RETRY_HINT}</span> : null}
      </WidgetBanner>
    );
  }

  function renderAttachmentNotice() {
    if (!attachmentNotice) {
      return null;
    }
    return <WidgetBanner tone="success">{ATTACHMENT_NOTICES[attachmentNotice.kind][attachmentNotice.direction]}</WidgetBanner>;
  }

  function renderHint(attachmentCount: number) {
    if (attachmentCount > 0 && message.trim().length === 0) {
      return (
        <Text type="supporting" color="accent">
          한 줄이라도 내용을 적으면 보낼 수 있어요
        </Text>
      );
    }
    return (
      <Text type="supporting">
        Enter 줄바꿈 · <Kbd keys="mod+enter" /> 보내기
      </Text>
    );
  }

  function renderGreeting(isBusy: boolean) {
    const greetingName = reporter ? `, ${reporter.name} 님` : '';
    return (
      <ChatMessage sender="assistant" avatar={<Avatar name={WIDGET_TEAM_NAME} size="sm" shape="rounded" tooltip={false} />} name={null}>
        <ChatMessageBubble group="first">
          <Text as="p" weight="semibold">
            안녕하세요{greetingName}
          </Text>
        </ChatMessageBubble>
        <ChatMessageBubble group="last">
          <Text as="p">
            불편한 점을 편하게 적어 주세요. 글로 설명하기 어려우면 아래 도구로 <Text weight="semibold">화면에서 직접</Text> 보여주셔도 돼요.
          </Text>
        </ChatMessageBubble>
        <SegmentedControl label="피드백 유형" value={type} onChange={handleTypeChange} size="lg" isDisabled={isBusy}>
          {FEEDBACK_TYPE_OPTIONS.map((option) => (
            <SegmentedControlItem key={option.value} value={option.value} label={option.label} />
          ))}
        </SegmentedControl>
      </ChatMessage>
    );
  }

  function renderCompose() {
    const isBusy = status === 'submitting';
    const attachmentCount = (attachments ? countAttachments(attachments) : 0) + screens.snapshots.length;
    const isReady = isInitialized && captureState !== null;

    return (
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
        <WidgetHeader
          title={WIDGET_TITLE}
          subtitle={isInitialized ? getSubtitle(reporter) : '준비하는 중이에요…'}
          onClose={notifyClose}
        />
        <WidgetBody>
          {isInitialized ? renderGreeting(isBusy) : (
            <div role="status" aria-label="준비하는 중이에요">
              <Card padding={3}>
                <VStack gap={2}>
                  {LOADING_LINE_WIDTHS.map((width, index) => <Skeleton key={width} height={12} width={width} index={index} />)}
                </VStack>
              </Card>
            </div>
          )}
          {screens.truncatedFlowScreenIds.size > 0 ? <WidgetBanner tone="warning">{FLOW_TRUNCATED_MESSAGE}</WidgetBanner> : null}
          {attachmentCount > 0 ? (
            <section aria-label="첨부한 화면 정보">
              <VStack gap={2}>
                <HStack gap={2} justify="between" align="center">
                  <Text type="label">첨부한 화면 정보 {attachmentCount}개</Text>
                  <Text type="supporting">보낼 때 함께 전달돼요</Text>
                </HStack>
                <ul ref={attachmentListRef} className="flex flex-col gap-2">
                  {attachments ? (
                    <CaptureAttachmentCards
                      attachments={attachments}
                      disabled={isBusy}
                      onRemove={(kind, index) => {
                        sendCaptureCommand(createCaptureCommand({ type: 'attachment:remove', payload: { kind, index } }));
                        if (kind === 'flow') {
                          screens.removeFlowScreens();
                        }
                      }}
                    />
                  ) : null}
                  <ScreenSnapshotControls
                    snapshots={screens.snapshots}
                    captures={screens.captures}
                    markedScreenIds={screens.markedScreenIds}
                    flowScreenIds={screens.flowScreenIds}
                    truncatedFlowScreenIds={screens.truncatedFlowScreenIds}
                    disabled={isBusy}
                    onRemove={screens.remove}
                  />
                </ul>
              </VStack>
            </section>
          ) : null}
        </WidgetBody>
        <WidgetFooter>
          {captureState && !captureState.enabled ? (
            <WidgetBanner tone="warning">이 페이지에서는 화면 첨부를 쓸 수 없어요. 글로만 보내도 괜찮아요.</WidgetBanner>
          ) : null}
          {captureState?.errorMessage ? <WidgetBanner tone="danger" isAlert>{captureState.errorMessage}</WidgetBanner> : null}
          {screens.errorMessage ? <WidgetBanner tone="danger" isAlert>{screens.errorMessage}</WidgetBanner> : null}
          {renderSubmitError()}
          {renderProgress()}
          {renderAttachmentNotice()}
          <CaptureToolBar
            attachments={attachments}
            enabled={captureState?.enabled ?? false}
            disabled={!isReady || isBusy}
            screenCount={screens.snapshots.length}
            isSavingScreen={screens.status !== 'idle'}
            canCaptureScreen={isInitialized && screens.canCapture}
            screenToolTitle={SCREEN_TOOL_TITLE}
            onStart={(mode) => sendCaptureCommand(createCaptureCommand({ type: 'capture:start', payload: { mode } }))}
            onCaptureScreen={screens.capture}
          />
          <HStack gap={2} align="end">
            <TextArea
              ref={composerRef}
              label={MESSAGE_LABEL}
              aria-label={MESSAGE_LABEL}
              isLabelHidden
              isRequired
              placeholder="어떤 점이 불편하셨나요?"
              rows={2}
              value={message}
              htmlMaxLength={MAX_MESSAGE_LENGTH}
              isDisabled={!isInitialized || isBusy}
              containerClassName="widget-composer-field min-w-0 flex-1"
              onChange={setMessage}
              onKeyDown={handleMessageKeyDown}
            />
            <IconButton
              ref={sendButtonRef}
              type="submit"
              label={SEND_LABEL}
              tooltip={SEND_LABEL}
              icon={<Icon icon={SendIcon} />}
              variant="primary"
              size="lg"
              isDisabled={!canSubmit}
            />
          </HStack>
          <HStack gap={2} justify="between" align="center">
            {renderHint(attachmentCount)}
            <Text type="supporting" hasTabularNumbers>
              {message.length}/{MAX_MESSAGE_LENGTH}
            </Text>
          </HStack>
        </WidgetFooter>
      </form>
    );
  }

  function renderContent() {
    if (bridgeErrorMessage) {
      return renderUnavailable(bridgeErrorMessage);
    }
    if (status === 'success') {
      return renderSuccess();
    }
    if (isInitialized && captureState?.activeMode) {
      return (
        <CaptureModeView
          activeMode={captureState.activeMode}
          attachments={captureState.attachments}
          selection={captureState.selection}
          flowEventCount={captureState.flowEventCount}
          disabled={status === 'submitting'}
          onClose={notifyClose}
          onCancel={() => sendCaptureCommand(createCaptureCommand({ type: 'capture:cancel', payload: {} }))}
          onStopFlow={() => sendCaptureCommand(createCaptureCommand({ type: 'flow:stop', payload: {} }))}
          onAddComment={(comment) => sendCaptureCommand(createCaptureCommand({ type: 'comment:add', payload: { comment } }))}
        />
      );
    }
    return renderCompose();
  }

  return <div ref={rootRef} lang="ko" className="widget-root flex h-dvh flex-col overflow-hidden">
    {config && isInitialized ? (
      <ConversationPanel key={JSON.stringify([config, reporter])} config={config} reporter={reporter} isOpen={isOpen} onClose={notifyClose}>
        {renderContent()}
      </ConversationPanel>
    ) : renderContent()}
  </div>;
}
