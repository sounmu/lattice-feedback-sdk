'use client';

import { useState } from 'react';

import { AdminSection } from '@/components/admin/AdminSection';
import { useAdminToken } from '@/hooks/useAdminToken';
import { useCreateTicket } from '@/hooks/useCreateTicket';
import { createTicketDraft } from '@/lib/ticket-draft';
import { MAX_TICKET_BODY_LENGTH, MAX_TICKET_TITLE_LENGTH } from '@/lib/ticket-limits';
import type { FeedbackDetailResponse } from '@/types/feedback';

type CopyStatus = 'idle' | 'copied' | 'failed';

/** A ticket draft made from the feedback. The admin edits it here and copies it into an issue tracker. */
export function TicketDraftPanel({ detail, projectKey }: { detail: FeedbackDetailResponse; projectKey: string }) {
  const token = useAdminToken();
  const notion = useCreateTicket({ projectKey, token, id: detail.feedback.id });
  // Made once per feedback, in the browser: its links start with this admin app's own address.
  const [draft, setDraft] = useState(() => createTicketDraft(detail, window.location.origin));
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  // The link saved with the feedback shows a ticket made earlier, also after a reload or from another screen.
  const postedUrl = notion.url || detail.feedback.ticketUrl;
  const isTooLong = draft.title.length > MAX_TICKET_TITLE_LENGTH || draft.body.length > MAX_TICKET_BODY_LENGTH;

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
        피드백 내용과 SDK 기록으로 만든 초안이에요. 고친 뒤 노션 보드에 올리거나 복사해서 이슈 트래커에 붙여 넣으세요. 여기서 고친 내용은 저장되지 않아요.
      </p>

      <label htmlFor="ticket-title" className="text-sm font-semibold">
        제목
      </label>
      <input
        id="ticket-title"
        type="text"
        value={draft.title}
        onChange={(event) => handleChange({ title: event.target.value })}
        maxLength={MAX_TICKET_TITLE_LENGTH}
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
        maxLength={MAX_TICKET_BODY_LENGTH}
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
        {postedUrl ? null : (
          <button
            type="button"
            onClick={() => notion.create(draft)}
            disabled={notion.status === 'creating' || isTooLong}
            className="min-h-11 rounded-[10px] border border-(--admin-primary) px-5 font-semibold text-(--admin-primary) hover:bg-(--admin-primary-weak) disabled:opacity-50"
          >
            {notion.status === 'creating' ? '올리는 중…' : '노션에 올리기'}
          </button>
        )}
        <p role="status" className="text-sm text-(--admin-text-sub)">
          {copyStatus === 'copied' ? '복사했어요.' : ''}
        </p>
        {postedUrl ? (
          <p role="status" className="text-sm text-(--admin-success)">
            노션에 올렸어요.{' '}
            <a href={postedUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
              노션에서 열기
            </a>
          </p>
        ) : null}
        {notion.status === 'failed' ? (
          <p role="alert" className="text-sm text-(--admin-danger)">
            {notion.errorMessage}
          </p>
        ) : null}
        {copyStatus === 'failed' ? (
          <p role="alert" className="text-sm text-(--admin-danger)">
            복사하지 못했어요. 본문을 직접 선택해 복사해 주세요.
          </p>
        ) : null}
      </div>
    </AdminSection>
  );
}
