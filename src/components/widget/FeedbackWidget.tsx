'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { useHostBridge } from '@/hooks/useHostBridge';
import { useScreenSnapshots } from '@/hooks/useScreenSnapshots';
import { useSubmitFeedback } from '@/hooks/useSubmitFeedback';
import { CaptureControls } from '@/components/widget/CaptureControls';
import { ScreenSnapshotControls } from '@/components/widget/ScreenSnapshotControls';
import { createCaptureCommand } from '@/lib/capture-protocol';
import type { FeedbackReporter, FeedbackType } from '@/types/feedback';

const MAX_MESSAGE_LENGTH = 5000;

const ANONYMOUS_REPORTER: FeedbackReporter = { id: 'anonymous', name: 'Anonymous' };

const FEEDBACK_TYPE_OPTIONS: { value: FeedbackType; label: string }[] = [
  { value: 'bug', label: '버그' },
  { value: 'improvement', label: '개선 제안' },
  { value: 'question', label: '질문' },
  { value: 'other', label: '기타' },
];

export function FeedbackWidget() {
  const {
    config, errorMessage: bridgeErrorMessage, reporter, page, isInitialized, notifyClose, notifySubmitted,
    captureState, sendCaptureCommand, subscribeToScreenCapture, requestScreenCapture,
  } = useHostBridge();
  const screens = useScreenSnapshots({ config, subscribeToScreenCapture, requestScreenCapture });
  const { syncCommentKeys } = screens;
  const commentKeys = captureState?.commentKeys;

  useEffect(() => {
    syncCommentKeys(commentKeys ?? []);
  }, [commentKeys, syncCommentKeys]);
  const { submit, reset, status, errorMessage } = useSubmitFeedback();
  const [message, setMessage] = useState('');
  const [type, setType] = useState<FeedbackType>('bug');

  const canSubmit = isInitialized && page !== null && message.trim().length > 0 &&
    status !== 'submitting' && !captureState?.activeMode && screens.status === 'idle';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config || !page || !canSubmit) {
      return;
    }
    const result = await submit({
      projectKey: config.projectKey,
      hostOrigin: config.hostOrigin,
      message: message.trim(),
      type,
      reporter: reporter ?? ANONYMOUS_REPORTER,
      page,
      attachments: captureState?.attachments,
      screenSnapshotIds: screens.snapshots.map((snapshot) => snapshot.id),
    });
    if (result) {
      notifySubmitted(result.feedback.id);
    }
  }

  function handleWriteAnother() {
    setMessage('');
    setType('bug');
    reset();
    screens.reset();
    sendCaptureCommand(createCaptureCommand({ type: 'draft:reset', payload: {} }));
  }

  function renderBody() {
    if (bridgeErrorMessage) {
      return <p className="text-sm text-red-600">{bridgeErrorMessage}</p>;
    }
    if (status === 'success') {
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm">전송되었습니다</p>
          <button type="button" className="rounded border px-3 py-2 text-sm" onClick={handleWriteAnother}>
            다른 피드백 작성
          </button>
        </div>
      );
    }
    return (
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <select
          aria-label="피드백 유형"
          className="rounded border p-2 text-sm"
          value={type}
          onChange={(event) => setType(event.target.value as FeedbackType)}
        >
          {FEEDBACK_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <textarea
          aria-label="피드백 내용"
          className="min-h-32 rounded border p-2 text-sm"
          value={message}
          maxLength={MAX_MESSAGE_LENGTH}
          required
          onChange={(event) => setMessage(event.target.value)}
        />
        {isInitialized && (
          <ScreenSnapshotControls
            snapshots={screens.snapshots}
            commentScreenIds={screens.commentScreenIds}
            status={screens.status}
            errorMessage={screens.errorMessage}
            canCapture={screens.canCapture}
            disabled={status === 'submitting'}
            onCapture={screens.capture}
            onRemove={screens.remove}
          />
        )}
        {captureState && (
          <CaptureControls
            attachments={captureState.attachments}
            activeMode={captureState.activeMode}
            selection={captureState.selection}
            enabled={captureState.enabled}
            disabled={status === 'submitting'}
            onStart={(mode) => sendCaptureCommand(createCaptureCommand({ type: 'capture:start', payload: { mode } }))}
            onCancel={() => sendCaptureCommand(createCaptureCommand({ type: 'capture:cancel', payload: {} }))}
            onStopFlow={() => sendCaptureCommand(createCaptureCommand({ type: 'flow:stop', payload: {} }))}
            onAddComment={(comment) => {
              sendCaptureCommand(createCaptureCommand({ type: 'comment:add', payload: { comment } }));
              // Saved right away so the admin sees the comment pinned on the screen it was written on.
              screens.captureForComment();
            }}
            onRemove={(kind, index) => sendCaptureCommand(createCaptureCommand({ type: 'attachment:remove', payload: { kind, index } }))}
          />
        )}
        {captureState?.errorMessage && <p role="alert" className="text-sm text-red-600">{captureState.errorMessage}</p>}
        {status === 'error' && <p className="text-sm text-red-600">{errorMessage}</p>}
        <button
          type="submit"
          className="min-h-11 rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
          disabled={!canSubmit}
        >
          보내기
        </button>
      </form>
    );
  }

  return (
    <div className="flex min-h-screen flex-col gap-3 bg-white p-4 text-gray-900">
      <header className="flex items-center justify-between">
        <h1 className="text-base font-semibold">피드백 보내기</h1>
        <button type="button" aria-label="닫기" className="px-2 text-lg" onClick={notifyClose}>
          ×
        </button>
      </header>
      <p className="text-xs text-gray-500">{reporter ? reporter.name : 'Anonymous'}</p>
      {renderBody()}
    </div>
  );
}
