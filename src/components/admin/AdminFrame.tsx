import type { ReactNode } from 'react';

interface AdminFrameProps {
  projectKey: string;
  hasToken: boolean;
  onSignOut: () => void;
  /** Uses the full width of a large screen, for pages that show two panes side by side. */
  isWide?: boolean;
  children: ReactNode;
}

export function AdminFrame({ projectKey, hasToken, onSignOut, isWide = false, children }: AdminFrameProps) {
  const widthClassName = isWide ? 'max-w-5xl xl:max-w-[1440px]' : 'max-w-5xl';

  return (
    <div className="admin-root">
      <header className="border-b border-(--admin-border) bg-(--admin-surface)">
        <div className={`mx-auto flex items-center justify-between gap-3 px-4 py-3 ${widthClassName}`}>
          <div className="flex items-baseline gap-2">
            <span className="text-base font-bold">Lattice 피드백 관리</span>
            <span className="text-xs text-(--admin-text-muted)">프로젝트 {projectKey}</span>
          </div>
          {hasToken ? (
            <button
              type="button"
              onClick={onSignOut}
              className="min-h-11 rounded-[10px] border border-(--admin-border) px-4 text-sm text-(--admin-text-sub) hover:bg-(--admin-surface-sub)"
            >
              토큰 지우기
            </button>
          ) : null}
        </div>
      </header>
      <main className={`mx-auto px-4 py-6 ${widthClassName}`}>{children}</main>
    </div>
  );
}
