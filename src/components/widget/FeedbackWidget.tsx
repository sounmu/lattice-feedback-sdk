'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { useHostBridge } from '@/hooks/useHostBridge';
import { useScreenSnapshots, type ScreenSaveStatus } from '@/hooks/useScreenSnapshots';
import { useSubmitFeedback } from '@/hooks/useSubmitFeedback';
import {
  CaptureAttachmentCards,
  CaptureModeView,
  CaptureToolBar,
  countAttachments,
} from '@/components/widget/CaptureControls';
import { ScreenSnapshotControls } from '@/components/widget/ScreenSnapshotControls';
import { CheckIcon, SendIcon } from '@/components/widget/WidgetIcons';
import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  WidgetBanner,
  WidgetBody,
  WidgetFooter,
  WidgetHeader,
} from '@/components/widget/WidgetLayout';
import { createCaptureCommand } from '@/lib/capture-protocol';
import type { FeedbackReporter, FeedbackType } from '@/types/feedback';
import type { CaptureState } from '@/types/sdk-message';

const MAX_MESSAGE_LENGTH = 5000;

const ANONYMOUS_REPORTER: FeedbackReporter = { id: 'anonymous', name: 'Anonymous' };

const FEEDBACK_TYPE_OPTIONS: { value: FeedbackType; label: string }[] = [
  { value: 'bug', label: '버그' },
  { value: 'improvement', label: '개선 제안' },
  { value: 'question', label: '질문' },
  { value: 'other', label: '기타' },
];

const WIDGET_TITLE = '피드백 보내기';
const REPLY_NOTICE = '보통 1영업일 안에 답변드려요';
const SCREEN_TOOL_TITLE = '지금 보고 있는 화면을 그대로 저장해 함께 보내요. 비밀번호 입력값은 저장하지 않아요.';
const FLOW_TRUNCATED_MESSAGE = '기록이 너무 길었거나 저장할 수 없는 페이지로 이동해서, 뒷부분은 재생에서 빠졌어요.';
const SUBMIT_RETRY_MESSAGE = '잠시 후 다시 시도해 주세요. 작성한 내용은 그대로 남아 있어요.';

const SCREEN_PROGRESS_MESSAGES: Record<Exclude<ScreenSaveStatus, 'idle'>, string> = {
  capturing: '화면을 저장하는 중이에요…',
  uploading: '저장한 화면을 올리는 중이에요…',
};

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

export function FeedbackWidget() {
  const {
    config, errorMessage: bridgeErrorMessage, reporter, page, isInitialized, notifyClose, notifySubmitted,
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

  const canSubmit = isInitialized && page !== null && message.trim().length > 0 &&
    status !== 'submitting' && !captureState?.activeMode && screens.status === 'idle';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config || !page || !canSubmit) {
      return;
    }
    const attachments = captureState?.attachments;
    const screenSnapshotIds = screens.snapshots.map((snapshot) => snapshot.id);
    const result = await submit({
      projectKey: config.projectKey,
      hostOrigin: config.hostOrigin,
      message: message.trim(),
      type,
      reporter: reporter ?? ANONYMOUS_REPORTER,
      page,
      attachments,
      screenSnapshotIds,
    });
    if (result) {
      setSubmittedSummary({
        typeLabel: getTypeLabel(type),
        pageTitle: page.title || page.url,
        attachments: getAttachmentSummary(attachments, screenSnapshotIds.length),
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

  function handleWriteAnother() {
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
          <p className="rounded-xl border border-fw-border bg-fw-surface p-3 font-mono text-xs text-fw-sub">원인(개발자용): {reason}</p>
        </WidgetBody>
        <WidgetFooter>
          <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={notifyClose}>
            닫기
          </button>
        </WidgetFooter>
      </>
    );
  }

  function renderSuccess() {
    return (
      <>
        <WidgetHeader title={WIDGET_TITLE} subtitle={getSubtitle(reporter)} onClose={notifyClose} />
        <WidgetBody>
          <div role="status" className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-fw-success-weak text-fw-success">
              <CheckIcon className="size-7" />
            </span>
            <p className="text-base font-bold">피드백이 전달됐어요</p>
            <p className="text-fw-sub">담당자가 확인한 뒤 답변드릴게요.</p>
          </div>
          {submittedSummary ? (
            <dl className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-2 gap-y-1 rounded-xl border border-fw-border bg-fw-surface p-3">
              <dt className="text-fw-muted">유형</dt>
              <dd>{submittedSummary.typeLabel}</dd>
              <dt className="text-fw-muted">페이지</dt>
              <dd className="truncate">{submittedSummary.pageTitle}</dd>
              <dt className="text-fw-muted">첨부</dt>
              <dd>{submittedSummary.attachments}</dd>
            </dl>
          ) : null}
        </WidgetBody>
        <WidgetFooter>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={notifyClose}>
              닫기
            </button>
            <button type="button" className={PRIMARY_BUTTON_CLASS} onClick={handleWriteAnother}>
              다른 피드백 작성
            </button>
          </div>
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

  function renderHint(attachmentCount: number) {
    if (attachmentCount > 0 && message.trim().length === 0) {
      return <span className="text-fw-primary">한 줄이라도 내용을 적으면 보낼 수 있어요</span>;
    }
    return <span>Enter 줄바꿈 · ⌘+Enter 보내기</span>;
  }

  function renderCompose() {
    const isBusy = status === 'submitting';
    const attachments = captureState?.attachments ?? null;
    const attachmentCount = (attachments ? countAttachments(attachments) : 0) + screens.snapshots.length;
    const isReady = isInitialized && captureState !== null;
    const greetingName = reporter ? `, ${reporter.name} 님` : '';

    return (
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
        <WidgetHeader
          title={WIDGET_TITLE}
          subtitle={isInitialized ? getSubtitle(reporter) : '준비하는 중이에요…'}
          onClose={notifyClose}
        />
        <WidgetBody>
          {isInitialized ? (
            <div className="flex gap-2">
              <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-fw-primary text-xs font-bold text-white">
                L
              </span>
              <div className="flex min-w-0 flex-col gap-2 rounded-2xl rounded-tl-sm border border-fw-border bg-fw-surface p-3">
                <p className="font-semibold">안녕하세요{greetingName} 👋</p>
                <p className="text-fw-sub">
                  불편한 점을 편하게 적어 주세요. 글로 설명하기 어려우면 아래 도구로 <strong className="text-fw-text">화면에서 직접</strong> 보여주셔도 돼요.
                </p>
                <div role="radiogroup" aria-label="피드백 유형" className="flex flex-wrap gap-1.5">
                  {FEEDBACK_TYPE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={type === option.value}
                      disabled={isBusy}
                      className="min-h-9 rounded-full border border-fw-border px-3.5 text-fw-sub aria-checked:border-fw-primary aria-checked:bg-fw-primary aria-checked:font-semibold aria-checked:text-white disabled:opacity-50"
                      onClick={() => setType(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div role="status" aria-label="준비하는 중이에요" className="flex flex-col gap-2 rounded-2xl border border-fw-border bg-fw-surface p-3">
              <span className="widget-skeleton block h-3 w-4/5 rounded bg-fw-border" />
              <span className="widget-skeleton block h-3 w-3/5 rounded bg-fw-border" />
              <span className="widget-skeleton block h-3 w-2/3 rounded bg-fw-border" />
            </div>
          )}
          {screens.truncatedFlowScreenIds.size > 0 ? <WidgetBanner tone="warning">{FLOW_TRUNCATED_MESSAGE}</WidgetBanner> : null}
          {attachmentCount > 0 ? (
            <section aria-label="첨부한 화면 정보" className="flex flex-col gap-2">
              <p className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-semibold text-fw-text">첨부한 화면 정보 {attachmentCount}개</span>
                <span className="text-fw-muted">보낼 때 함께 전달돼요</span>
              </p>
              <ul className="flex flex-col gap-2">
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
            </section>
          ) : null}
        </WidgetBody>
        <WidgetFooter>
          {captureState && !captureState.enabled ? (
            <WidgetBanner tone="warning">이 페이지에서는 화면 첨부를 쓸 수 없어요. 글로만 보내도 괜찮아요.</WidgetBanner>
          ) : null}
          {captureState?.errorMessage ? <WidgetBanner tone="danger" isAlert>{captureState.errorMessage}</WidgetBanner> : null}
          {screens.errorMessage ? <WidgetBanner tone="danger" isAlert>{screens.errorMessage}</WidgetBanner> : null}
          {status === 'error' ? (
            <WidgetBanner tone="danger" title="전송하지 못했어요" isAlert>
              {errorMessage || SUBMIT_RETRY_MESSAGE}
            </WidgetBanner>
          ) : null}
          {renderProgress()}
          <CaptureToolBar
            attachments={attachments}
            enabled={captureState?.enabled ?? false}
            disabled={!isReady || isBusy}
            screenCount={screens.snapshots.length}
            canCaptureScreen={isInitialized && screens.canCapture}
            screenToolTitle={SCREEN_TOOL_TITLE}
            onStart={(mode) => sendCaptureCommand(createCaptureCommand({ type: 'capture:start', payload: { mode } }))}
            onCaptureScreen={screens.capture}
          />
          <div className="flex items-end gap-2 rounded-xl border border-fw-border p-1.5 focus-within:border-fw-primary">
            <textarea
              aria-label="피드백 내용"
              placeholder="어떤 점이 불편하셨나요?"
              rows={2}
              className="max-h-[6.2em] min-h-[3.1em] flex-1 resize-none px-1.5 py-1 outline-none [field-sizing:content] focus-visible:outline-none disabled:opacity-50"
              value={message}
              maxLength={MAX_MESSAGE_LENGTH}
              required
              disabled={!isInitialized || isBusy}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={handleMessageKeyDown}
            />
            <button
              type="submit"
              aria-label="보내기"
              className="flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-fw-primary text-white hover:bg-fw-primary-hover disabled:opacity-40"
              disabled={!canSubmit}
            >
              <SendIcon />
            </button>
          </div>
          <p className="flex justify-between gap-2 text-xs text-fw-muted">
            {renderHint(attachmentCount)}
            <span>
              {message.length}/{MAX_MESSAGE_LENGTH}
            </span>
          </p>
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

  return <div className="widget-root flex h-dvh flex-col overflow-hidden">{renderContent()}</div>;
}
