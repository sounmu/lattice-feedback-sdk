'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { AdminFrame } from '@/components/admin/AdminFrame';
import { AdminStatusGate } from '@/components/admin/AdminStatusGate';
import { FeedbackDetailPane } from '@/components/admin/FeedbackDetailPane';
import { FeedbackListView } from '@/components/admin/FeedbackListView';
import { SidePaneToggle } from '@/components/admin/SidePaneToggle';
import { useAdminProjectKey } from '@/hooks/useAdminProjectKey';
import { useAdminToken } from '@/hooks/useAdminToken';
import { useCollapsedSection } from '@/hooks/useCollapsedSection';
import { useFeedbackList } from '@/hooks/useFeedbackList';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { saveAdminToken } from '@/lib/admin-token';

/** Matches the xl breakpoint the layout classes below use. */
const SPLIT_VIEW_MEDIA_QUERY = '(min-width: 1280px)';
const SELECTED_FEEDBACK_PARAMETER = 'feedback';
// Each pane scrolls on its own, under the header.
const PANE_CLASS_NAME = 'xl:h-[calc(100vh-7.5rem)] xl:overflow-y-auto';

export function FeedbackListPage() {
  const projectKey = useAdminProjectKey();
  const token = useAdminToken();
  const searchParams = useSearchParams();
  const { status, items, errorMessage, reload } = useFeedbackList({ projectKey, token });
  const [nowTimestamp] = useState(() => Date.now());
  // On a wide screen the chosen feedback opens next to the list. On a narrow one the list links to its own page.
  const isSplitView = useMediaQuery(SPLIT_VIEW_MEDIA_QUERY);
  const selectedId = isSplitView ? searchParams.get(SELECTED_FEEDBACK_PARAMETER) : null;
  const listPane = useCollapsedSection('list-pane');
  // Folded to a narrow strip, the list stays mounted, so J and K keep moving through it.
  const isListCollapsed = isSplitView && listPane.isCollapsed;
  const columnsClassName = isListCollapsed ? 'xl:grid-cols-[48px_minmax(0,1fr)]' : 'xl:grid-cols-[380px_minmax(0,1fr)]';

  function handleSelect(id: string) {
    const parameters = new URLSearchParams(searchParams);
    parameters.set(SELECTED_FEEDBACK_PARAMETER, id);
    // Kept in the address so a reload or a shared link opens the same feedback, without a request to the server.
    window.history.replaceState(null, '', `?${parameters.toString()}`);
  }

  return (
    <AdminFrame projectKey={projectKey} hasToken={token !== ''} onSignOut={() => saveAdminToken('')} isWide>
      <AdminStatusGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <div className={`xl:grid xl:gap-6 ${columnsClassName}`}>
          <div className={`${PANE_CLASS_NAME} xl:pr-1`}>
            {isListCollapsed ? <SidePaneToggle isCollapsed side="left" label="피드백 목록" onToggle={listPane.toggle} /> : null}
            <div hidden={isListCollapsed}>
              <FeedbackListView
                items={items}
                projectKey={projectKey}
                nowTimestamp={nowTimestamp}
                onReload={reload}
                selectedId={selectedId}
                onSelect={isSplitView ? handleSelect : undefined}
                onCollapse={isSplitView ? listPane.toggle : undefined}
              />
            </div>
          </div>
          {isSplitView ? (
            <div className={PANE_CLASS_NAME}>
              {selectedId ? (
                <FeedbackDetailPane projectKey={projectKey} token={token} id={selectedId} onSaved={reload} />
              ) : (
                <p className="rounded-2xl border border-dashed border-(--admin-border) p-8 text-center text-(--admin-text-muted)">
                  목록에서 피드백을 고르면 여기에서 바로 볼 수 있어요.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </AdminStatusGate>
    </AdminFrame>
  );
}
