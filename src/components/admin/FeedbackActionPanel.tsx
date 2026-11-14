'use client';

import { useEffect, useEffectEvent, useState } from 'react';

import { DuplicateOriginalPicker } from '@/components/admin/DuplicateOriginalPicker';
import { ShortcutKey } from '@/components/admin/ShortcutKey';
import type { SaveStatus } from '@/hooks/useFeedbackDetail';
import { findAdminShortcut, type AdminShortcut } from '@/lib/admin-shortcuts';
import { createFeedbackChanges } from '@/lib/feedback-changes';
import { FEEDBACK_STATUS_LABELS, FEEDBACK_STATUSES } from '@/lib/feedback-display';
import type { Feedback, FeedbackStatus, UpdateFeedbackInput } from '@/types/feedback';

interface FeedbackActionPanelProps {
  feedback: Feedback;
  saveStatus: SaveStatus;
  saveErrorMessage: string;
  onSave: (changes: UpdateFeedbackInput) => Promise<boolean>;
}

// Statuses a single key press saves. A duplicate needs its original first, so its key only opens the picker.
const SHORTCUT_STATUSES: Partial<Record<AdminShortcut, FeedbackStatus>> = { accept: 'in_progress', reject: 'rejected' };

const SAVE_STATUS_MESSAGES: Record<SaveStatus, string> = {
  idle: '',
  saving: '저장하는 중이에요…',
  saved: '저장했어요.',
  failed: '',
};

export function FeedbackActionPanel({ feedback, saveStatus, saveErrorMessage, onSave }: FeedbackActionPanelProps) {
  const [status, setStatus] = useState<FeedbackStatus>(feedback.status);
  const [reply, setReply] = useState(feedback.adminReply ?? '');
  const [duplicateOfId, setDuplicateOfId] = useState(feedback.duplicateOfId ?? '');
  const isSaving = saveStatus === 'saving';
  const isOriginalMissing = status === 'duplicate' && duplicateOfId === '';
  const changes = createFeedbackChanges(feedback, { status, reply, duplicateOfId });
  const isChanged = Object.keys(changes).length > 0;

  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    const shortcut = findAdminShortcut(event);
    if (isSaving || shortcut === null) {
      return;
    }
    if (shortcut === 'duplicate') {
      event.preventDefault();
      setStatus('duplicate');
      return;
    }
    const nextStatus = SHORTCUT_STATUSES[shortcut];
    if (nextStatus === undefined) {
      return;
    }
    // Saved together with a reply the admin has typed, so the key never drops it.
    const shortcutChanges = createFeedbackChanges(feedback, { status: nextStatus, reply, duplicateOfId });
    if (Object.keys(shortcutChanges).length === 0) {
      return;
    }
    event.preventDefault();
    void onSave(shortcutChanges);
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleShortcut(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-(--admin-border) bg-(--admin-surface) p-4">
      <h2 className="text-base font-bold">처리하기</h2>

      <fieldset disabled={isSaving} className="flex flex-wrap gap-2">
        <legend className="mb-1 text-sm font-semibold">상태</legend>
        {FEEDBACK_STATUSES.map((option) => (
          <label
            key={option}
            className={`flex min-h-11 cursor-pointer items-center rounded-[10px] border px-4 font-semibold ${
              status === option
                ? 'border-(--admin-primary) bg-(--admin-primary-weak) text-(--admin-primary)'
                : 'border-(--admin-border) text-(--admin-text-sub)'
            }`}
          >
            <input type="radio" name="status" value={option} checked={status === option} onChange={() => setStatus(option)} className="sr-only" />
            {FEEDBACK_STATUS_LABELS[option]}
          </label>
        ))}
      </fieldset>
      <p className="hidden text-xs text-(--admin-text-muted) md:block">
        단축키: <ShortcutKey>1</ShortcutKey> {FEEDBACK_STATUS_LABELS.in_progress} · <ShortcutKey>2</ShortcutKey> {FEEDBACK_STATUS_LABELS.duplicate} ·{' '}
        <ShortcutKey>3</ShortcutKey> {FEEDBACK_STATUS_LABELS.rejected}
      </p>

      {status === 'duplicate' ? (
        <DuplicateOriginalPicker
          feedbackId={feedback.id}
          value={duplicateOfId}
          disabled={isSaving}
          // Chosen just now, so the admin can start searching right away.
          autoFocus={feedback.status !== 'duplicate'}
          onChange={setDuplicateOfId}
        />
      ) : null}

      <label htmlFor="admin-reply" className="text-sm font-semibold">
        답변
      </label>
      <textarea
        id="admin-reply"
        rows={5}
        disabled={isSaving}
        value={reply}
        onChange={(event) => setReply(event.target.value)}
        placeholder="작성자에게 보여줄 답변을 적어 주세요."
        className="rounded-[10px] border border-(--admin-border) p-3 focus:outline-2 focus:outline-(--admin-primary)"
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onSave(changes)}
          disabled={!isChanged || isSaving || isOriginalMissing}
          className="min-h-11 rounded-[10px] bg-(--admin-primary) px-5 font-semibold text-white hover:bg-(--admin-primary-hover) disabled:opacity-50"
        >
          저장
        </button>
        <p role="status" className="text-sm text-(--admin-text-sub)">
          {SAVE_STATUS_MESSAGES[saveStatus]}
        </p>
        {saveStatus === 'failed' ? (
          <p role="alert" className="text-sm text-(--admin-danger)">
            {saveErrorMessage}
          </p>
        ) : null}
      </div>
    </section>
  );
}
