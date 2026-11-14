interface SidePaneToggleProps {
  isCollapsed: boolean;
  /** The side of the screen the pane folds toward. */
  side: 'left' | 'right';
  /** Names the pane for screen readers and the tooltip. */
  label: string;
  onToggle: () => void;
  className?: string;
}

/** Folds a pane toward its side of the screen, or opens it again. */
export function SidePaneToggle({ isCollapsed, side, label, onToggle, className = '' }: SidePaneToggleProps) {
  const actionLabel = `${label} ${isCollapsed ? '펼치기' : '접기'}`;
  // The arrow points the way the pane will move.
  const pointsLeft = (side === 'left') !== isCollapsed;

  return (
    <button
      type="button"
      aria-expanded={!isCollapsed}
      aria-label={actionLabel}
      title={actionLabel}
      onClick={onToggle}
      className={`flex size-11 shrink-0 items-center justify-center rounded-[10px] border border-(--admin-border) bg-(--admin-surface) text-(--admin-text-sub) hover:bg-(--admin-surface-sub) ${className}`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className={`size-4 ${pointsLeft ? '' : 'rotate-180'}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 3.5L5.5 8l4.5 4.5" />
      </svg>
    </button>
  );
}
