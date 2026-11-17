import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';

import { PaneIcon } from '@/components/widget/WidgetIcons';

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
export function SidePaneToggle({ isCollapsed, side, label, onToggle, className }: SidePaneToggleProps) {
  const actionLabel = `${label} ${isCollapsed ? '펼치기' : '접기'}`;
  // The arrow points the way the pane will move.
  const pointsLeft = (side === 'left') !== isCollapsed;

  return (
    <IconButton
      label={actionLabel}
      tooltip={actionLabel}
      icon={<Icon icon={(props) => <PaneIcon {...props} side={side} pointsLeft={pointsLeft} />} />}
      variant="ghost"
      size="lg"
      aria-expanded={!isCollapsed}
      onClick={onToggle}
      className={className}
    />
  );
}
