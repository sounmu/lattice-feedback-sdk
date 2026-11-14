'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { AdminScreenReplay, fetchSavedScreen } from '@/components/admin/ScreenSnapshotViewer';
import { useAdminToken } from '@/hooks/useAdminToken';
import { findEditMoves } from '@/lib/screen-snapshot';
import type { ScreenSnapshot, ScreenSnapshotSummary } from '@/types/screen-snapshot';

interface EditScreenPreviewProps {
  screens: ScreenSnapshotSummary[];
  projectKey: string;
  /** Shown while the screen loads, and instead of it when no saved screen holds the edits. */
  fallback: ReactNode;
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
export function EditScreenPreview({ screens, projectKey, fallback }: EditScreenPreviewProps) {
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
  if (!snapshot) {
    return <>{fallback}</>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-(--admin-text-muted)">저장된 화면에서 요소를 제안 위치로 옮겨 보여줘요. 아래 버튼으로 원래 화면과 비교할 수 있어요.</p>
      <AdminScreenReplay snapshot={snapshot} projectKey={projectKey} token={token} initiallyShowsProposed />
    </div>
  );
}
