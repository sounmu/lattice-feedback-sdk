'use client';

import { useEffect, useState } from 'react';

import { EditComparison } from '@/components/admin/EditComparison';
import { AdminScreenReplay, fetchSavedScreen } from '@/components/admin/ScreenSnapshotViewer';
import { useAdminToken } from '@/hooks/useAdminToken';
import { findEditMoves, findUnshownEditIndexes } from '@/lib/screen-snapshot';
import type { EditAttachment } from '@/types/feedback';
import type { ScreenSnapshot, ScreenSnapshotSummary } from '@/types/screen-snapshot';

interface EditScreenPreviewProps {
  screens: ScreenSnapshotSummary[];
  projectKey: string;
  /** Drawn as plain boxes while the screen loads, and for every edit the saved screen does not show. */
  edits: EditAttachment[];
}

interface MarkedScreenState {
  requestKey: string;
  snapshot: ScreenSnapshot | null;
}

/**
 * Finds the saved screen that carries the edits. The widget saves it again after every edit, so the
 * newest screen holding edit moves has all of them.
 */
async function findMarkedScreen(
  screens: ScreenSnapshotSummary[],
  projectKey: string,
  token: string,
  signal: AbortSignal,
): Promise<ScreenSnapshot | null> {
  const newestFirst = [...screens].sort((first, second) => second.capturedAt.localeCompare(first.capturedAt));
  for (const screen of newestFirst) {
    const result = await fetchSavedScreen(screen.id, projectKey, token, signal);
    if ('snapshot' in result && findEditMoves(result.snapshot.events).length > 0) {
      return result.snapshot;
    }
  }
  return null;
}

/** Shows the saved page with the edited elements moved, so the admin sees the proposal on the real screen. */
export function EditScreenPreview({ screens, projectKey, edits }: EditScreenPreviewProps) {
  const token = useAdminToken();
  const [state, setState] = useState<MarkedScreenState | null>(null);
  const requestKey = JSON.stringify([projectKey, token, screens.map((screen) => screen.id)]);

  useEffect(() => {
    if (!token || screens.length === 0) {
      return;
    }
    const controller = new AbortController();
    findMarkedScreen(screens, projectKey, token, controller.signal).then(
      (snapshot) => setState({ requestKey, snapshot }),
      () => undefined,
    );
    return () => controller.abort();
  }, [screens, projectKey, token, requestKey]);

  const snapshot = state?.requestKey === requestKey ? state.snapshot : null;
  // An edit whose screen could not be saved is still part of the feedback, so it keeps its box drawing.
  const boxIndexes = snapshot ? findUnshownEditIndexes(edits.length, findEditMoves(snapshot.events)) : edits.map((_, index) => index);
  const boxes = boxIndexes.map((index) => <EditComparison key={`${edits[index].target.selector}-${index}`} edit={edits[index]} />);
  if (!snapshot) {
    return <>{boxes}</>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-(--admin-text-muted)">저장된 화면에서 요소를 제안 위치로 옮겨 보여줘요. 아래 버튼으로 원래 화면과 비교할 수 있어요.</p>
      <AdminScreenReplay snapshot={snapshot} projectKey={projectKey} token={token} initiallyShowsProposed />
      {boxes.length > 0 ? (
        <>
          <p className="text-xs text-(--admin-warning)">아래 위치 편집 {boxes.length}개는 저장된 화면에 표시되지 않아 상자 그림으로 보여줘요.</p>
          {boxes}
        </>
      ) : null}
    </div>
  );
}
