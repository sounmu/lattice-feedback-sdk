import Link from 'next/link';

import { formatDateTime, getPagePath } from '@/lib/feedback-display';
import type { ScreenSnapshotSummary } from '@/types/screen-snapshot';

interface SavedScreenListProps {
  screens: ScreenSnapshotSummary[];
  projectKey: string;
}

export function SavedScreenList({ screens, projectKey }: SavedScreenListProps) {
  return (
    <ul className="flex flex-col gap-2">
      {screens.map((screen) => (
        <li key={screen.id} className="flex items-center justify-between gap-3 rounded-xl bg-(--admin-surface-sub) p-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{screen.page.title || getPagePath(screen.page.url)}</p>
            <p className="text-xs text-(--admin-text-muted)">
              {getPagePath(screen.page.url)} · {formatDateTime(screen.capturedAt)}
              {screen.missingAssets.length > 0 ? ` · 가림·누락 기록 ${screen.missingAssets.length}개` : ''}
            </p>
          </div>
          <Link
            href={`/admin/snapshots/${encodeURIComponent(screen.id)}?projectKey=${encodeURIComponent(projectKey)}`}
            className="flex min-h-11 shrink-0 items-center rounded-[10px] bg-(--admin-primary) px-4 font-semibold text-white hover:bg-(--admin-primary-hover)"
          >
            화면 보기
          </Link>
        </li>
      ))}
    </ul>
  );
}
