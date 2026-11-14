'use client';

import Link from 'next/link';

import { AdminSection } from '@/components/admin/AdminSection';
import { CommentAttachmentList } from '@/components/admin/CommentAttachmentList';
import { EditScreenPreview } from '@/components/admin/EditScreenPreview';
import { FeedbackActionPanel } from '@/components/admin/FeedbackActionPanel';
import { StatusBadge, TypeBadge } from '@/components/admin/FeedbackBadges';
import { FlowTimeline } from '@/components/admin/FlowTimeline';
import { SavedScreenList } from '@/components/admin/SavedScreenList';
import { SidePaneToggle } from '@/components/admin/SidePaneToggle';
import { TicketDraftPanel } from '@/components/admin/TicketDraftPanel';
import { useCollapsedSection } from '@/hooks/useCollapsedSection';
import type { SaveStatus } from '@/hooks/useFeedbackDetail';
import { formatDateTime, getPagePath } from '@/lib/feedback-display';
import type { FeedbackDetailResponse, UpdateFeedbackInput } from '@/types/feedback';

interface FeedbackDetailViewProps {
  detail: FeedbackDetailResponse;
  projectKey: string;
  saveStatus: SaveStatus;
  saveErrorMessage: string;
  onSave: (changes: UpdateFeedbackInput) => Promise<boolean>;
  /** Shown next to the list instead of on its own page. */
  isEmbedded?: boolean;
}

export function FeedbackDetailView({ detail, projectKey, saveStatus, saveErrorMessage, onSave, isEmbedded = false }: FeedbackDetailViewProps) {
  const { feedback, screenSnapshots } = detail;
  const { comments, edits, flow } = feedback.attachments;
  const sidePane = useCollapsedSection('side-pane');
  // Side folding is for wide screens. On a narrow one the side content sits below and always shows.
  const columnsClassName = sidePane.isCollapsed ? 'md:grid-cols-[minmax(0,1fr)_44px]' : 'md:grid-cols-[minmax(0,1fr)_320px]';

  return (
    <div className="flex flex-col gap-4">
      {isEmbedded ? null : (
        <Link href={`/admin?projectKey=${encodeURIComponent(projectKey)}`} className="flex min-h-11 items-center text-(--admin-primary)">
          ← 목록으로
        </Link>
      )}

      <div className={`grid grid-cols-[minmax(0,1fr)] gap-4 ${columnsClassName}`}>
        <div className="flex flex-col gap-4">
          <AdminSection sectionKey="content" title="피드백 내용">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={feedback.status} />
              <TypeBadge type={feedback.type} />
            </div>
            {feedback.duplicateOfId ? (
              <p className="text-sm text-(--admin-text-sub)">
                먼저 접수된 피드백과 같은 내용으로 표시했어요.{' '}
                <Link
                  href={`/admin/feedback/${encodeURIComponent(feedback.duplicateOfId)}?projectKey=${encodeURIComponent(projectKey)}`}
                  className="font-semibold text-(--admin-primary)"
                >
                  원본 피드백 보기
                </Link>
              </p>
            ) : null}
            <p className="whitespace-pre-wrap text-base">{feedback.message}</p>
          </AdminSection>

          {comments.length > 0 ? (
            <AdminSection sectionKey="comments" title={`코멘트 ${comments.length}개`}>
              <CommentAttachmentList comments={comments} />
            </AdminSection>
          ) : null}

          {edits.length > 0 ? (
            <AdminSection sectionKey="edits" title={`위치 편집 ${edits.length}개`}>
              <EditScreenPreview screens={screenSnapshots} projectKey={projectKey} edits={edits} />
            </AdminSection>
          ) : null}

          {flow ? (
            <AdminSection sectionKey="flow" title={`흐름 기록 ${flow.events.length}개`}>
              <FlowTimeline flow={flow} />
            </AdminSection>
          ) : null}

          {screenSnapshots.length > 0 ? (
            <AdminSection sectionKey="screens" title="저장된 화면">
              <SavedScreenList screens={screenSnapshots} projectKey={projectKey} />
            </AdminSection>
          ) : null}

          <TicketDraftPanel key={feedback.id} detail={detail} />
        </div>

        <aside className="flex flex-col gap-4">
          <SidePaneToggle
            isCollapsed={sidePane.isCollapsed}
            side="right"
            label="처리 영역"
            onToggle={sidePane.toggle}
            className="hidden self-end md:flex"
          />
          <div className={`flex flex-col gap-4 ${sidePane.isCollapsed ? 'md:hidden' : ''}`}>
            <FeedbackActionPanel
              key={`${feedback.id}-${feedback.updatedAt}`}
              feedback={feedback}
              saveStatus={saveStatus}
              saveErrorMessage={saveErrorMessage}
              onSave={onSave}
            />
            <AdminSection sectionKey="reporter" title="보낸 사람 · 페이지">
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
            </AdminSection>
          </div>
        </aside>
      </div>
    </div>
  );
}
