'use client';

import { useState } from 'react';

import { AdminSection } from '@/components/admin/AdminSection';
import { createTicketDraft } from '@/lib/ticket-draft';
import type { FeedbackDetailResponse } from '@/types/feedback';

type CopyStatus = 'idle' | 'copied' | 'failed';

/** A ticket draft made from the feedback. The admin edits it here and copies it into an issue tracker. */
export function TicketDraftPanel({ detail }: { detail: FeedbackDetailResponse }) {
  // Made once per feedback, in the browser: its links start with this admin app's own address.
  const [draft, setDraft] = useState(() => createTicketDraft(detail, window.location.origin));
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');

  function handleChange(changes: Partial<typeof draft>) {
    setDraft((current) => ({ ...current, ...changes }));
    setCopyStatus('idle');
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(`# ${draft.title}\n\n${draft.body}\n`);
      setCopyStatus('copied');
    } catch {
      // The browser refused clipboard access; the admin can still select the text.
      setCopyStatus('failed');
    }
  }

  return (
    <AdminSection sectionKey="ticket-draft" title="티켓 초안">
      <p className="text-sm text-(--admin-text-sub)">
        피드백 내용과 SDK 기록으로 만든 초안이에요. 고친 뒤 복사해서 이슈 트래커에 붙여 넣으세요. 여기서 고친 내용은 저장되지 않아요.
      </p>

      <label htmlFor="ticket-title" className="text-sm font-semibold">
        제목
      </label>
      <input
        id="ticket-title"
        type="text"
        value={draft.title}
        onChange={(event) => handleChange({ title: event.target.value })}
        className="min-h-11 rounded-[10px] border border-(--admin-border) px-3 focus:outline-2 focus:outline-(--admin-primary)"
      />

      <label htmlFor="ticket-body" className="text-sm font-semibold">
        본문 (마크다운)
      </label>
      <textarea
        id="ticket-body"
        rows={14}
        value={draft.body}
        onChange={(event) => handleChange({ body: event.target.value })}
        className="rounded-[10px] border border-(--admin-border) p-3 font-mono text-sm focus:outline-2 focus:outline-(--admin-primary)"
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleCopy}
          className="min-h-11 rounded-[10px] bg-(--admin-primary) px-5 font-semibold text-white hover:bg-(--admin-primary-hover)"
        >
          마크다운 복사
        </button>
        <p role="status" className="text-sm text-(--admin-text-sub)">
          {copyStatus === 'copied' ? '복사했어요.' : ''}
        </p>
        {copyStatus === 'failed' ? (
          <p role="alert" className="text-sm text-(--admin-danger)">
            복사하지 못했어요. 본문을 직접 선택해 복사해 주세요.
          </p>
        ) : null}
      </div>
    </AdminSection>
  );
}
