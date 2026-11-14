import Link from 'next/link';
import type { ReactNode } from 'react';

import { CommentAttachmentList } from '@/components/admin/CommentAttachmentList';
import { EditScreenPreview } from '@/components/admin/EditScreenPreview';
import { FeedbackActionPanel } from '@/components/admin/FeedbackActionPanel';
import { StatusBadge, TypeBadge } from '@/components/admin/FeedbackBadges';
import { FlowTimeline } from '@/components/admin/FlowTimeline';
import { SavedScreenList } from '@/components/admin/SavedScreenList';
import { TicketDraftPanel } from '@/components/admin/TicketDraftPanel';
import type { SaveStatus } from '@/hooks/useFeedbackDetail';
import { formatDateTime, getPagePath } from '@/lib/feedback-display';
import type { FeedbackDetailResponse, UpdateFeedbackInput } from '@/types/feedback';

interface FeedbackDetailViewProps {
  detail: FeedbackDetailResponse;
  projectKey: string;
  saveStatus: SaveStatus;
  saveErrorMessage: string;
  onSave: (changes: UpdateFeedbackInput) => Promise<boolean>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-(--admin-border) bg-(--admin-surface) p-4">
      <h2 className="text-base font-bold">{title}</h2>
      {children}
    </section>
  );
}

export function FeedbackDetailView({ detail, projectKey, saveStatus, saveErrorMessage, onSave }: FeedbackDetailViewProps) {
  const { feedback, screenSnapshots } = detail;
  const { comments, edits, flow } = feedback.attachments;

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/admin?projectKey=${encodeURIComponent(projectKey)}`} className="flex min-h-11 items-center text-(--admin-primary)">
        ← 목록으로
      </Link>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <Section title="피드백 내용">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={feedback.status} />
              <TypeBadge type={feedback.type} />
            </div>
            <p className="whitespace-pre-wrap text-base">{feedback.message}</p>
          </Section>

          {comments.length > 0 ? (
            <Section title={`코멘트 ${comments.length}개`}>
              <CommentAttachmentList comments={comments} />
            </Section>
          ) : null}

          {edits.length > 0 ? (
            <Section title={`위치 편집 ${edits.length}개`}>
              <EditScreenPreview screens={screenSnapshots} projectKey={projectKey} edits={edits} />
            </Section>
          ) : null}

          {flow ? (
            <Section title={`흐름 기록 ${flow.events.length}개`}>
              <FlowTimeline flow={flow} />
            </Section>
          ) : null}

          {screenSnapshots.length > 0 ? (
            <Section title="저장된 화면">
              <SavedScreenList screens={screenSnapshots} projectKey={projectKey} />
            </Section>
          ) : null}

          <TicketDraftPanel key={feedback.id} detail={detail} />
        </div>

        <aside className="flex flex-col gap-4">
          <FeedbackActionPanel
            key={`${feedback.id}-${feedback.updatedAt}`}
            feedback={feedback}
            saveStatus={saveStatus}
            saveErrorMessage={saveErrorMessage}
            onSave={onSave}
          />
          <Section title="보낸 사람 · 페이지">
            <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-1">
              <dt className="text-(--admin-text-muted)">이름</dt>
              <dd>{feedback.reporter.name}</dd>
              {feedback.reporter.email ? (
                <>
                  <dt className="text-(--admin-text-muted)">이메일</dt>
                  <dd>{feedback.reporter.email}</dd>
                </>
              ) : null}
              <dt className="text-(--admin-text-muted)">페이지</dt>
              <dd>{getPagePath(feedback.page.url)}</dd>
              <dt className="text-(--admin-text-muted)">화면 크기</dt>
              <dd>
                {feedback.page.viewportWidth}×{feedback.page.viewportHeight}
              </dd>
              <dt className="text-(--admin-text-muted)">접수</dt>
              <dd>{formatDateTime(feedback.createdAt)}</dd>
              <dt className="text-(--admin-text-muted)">수정</dt>
              <dd>{formatDateTime(feedback.updatedAt)}</dd>
            </dl>
          </Section>
        </aside>
      </div>
    </div>
  );
}
