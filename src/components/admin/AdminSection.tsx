'use client';

import { useId, type ReactNode } from 'react';

import { useCollapsedSection } from '@/hooks/useCollapsedSection';

interface AdminSectionProps {
  /** Names the section in the saved fold preference. The same for every feedback. */
  sectionKey: string;
  title: string;
  children: ReactNode;
}

/** A card of the admin detail screen. Its heading folds it. Folded content stays mounted, so what the admin typed is kept. */
export function AdminSection({ sectionKey, title, children }: AdminSectionProps) {
  const { isCollapsed, toggle } = useCollapsedSection(sectionKey);
  const contentId = useId();

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-(--admin-border) bg-(--admin-surface) p-4">
      <h2>
        <button
          type="button"
          aria-expanded={!isCollapsed}
          aria-controls={contentId}
          onClick={toggle}
          // The negative margin keeps the heading where it was while the button gets a full-size touch area.
          className="-m-2 flex min-h-11 w-[calc(100%+1rem)] items-center justify-between gap-2 rounded-[10px] p-2 text-left text-base font-bold hover:bg-(--admin-surface-sub)"
        >
          <span className="min-w-0">{title}</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className={`size-4 shrink-0 text-(--admin-text-muted) transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3.5 6l4.5 4.5L12.5 6" />
          </svg>
        </button>
      </h2>
      <div id={contentId} hidden={isCollapsed} className="flex flex-col gap-3">
        {children}
      </div>
    </section>
  );
}
