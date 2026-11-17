import { describeMove, formatEditChange, formatRect, getComparisonBounds } from '@/lib/edit-comparison-geometry';
import { getElementLabel } from '@/lib/feedback-display';
import type { EditAttachment } from '@/types/feedback';

/** Draws the original and proposed boxes on a scaled page outline, so the move is visible at a glance. */
export function EditComparison({ edit }: { edit: EditAttachment }) {
  const { originalRect, proposedRect } = edit;
  const bounds = getComparisonBounds(edit.viewportWidth, edit.viewportHeight, [originalRect, proposedRect]);
  const change = formatEditChange(describeMove(originalRect, proposedRect, edit.rotation));

  function getBoxStyle(rect: EditAttachment['originalRect']) {
    return {
      left: `${(rect.x / bounds.width) * 100}%`,
      top: `${(rect.y / bounds.height) * 100}%`,
      width: `${(rect.width / bounds.width) * 100}%`,
      height: `${(rect.height / bounds.height) * 100}%`,
    };
  }

  return (
    <figure className="flex flex-col gap-2 rounded-(--radius-container) bg-(--admin-surface-sub) p-3">
      <div
        role="img"
        aria-label={`${getElementLabel(edit.target)} 변경: ${change}`}
        className="relative w-full overflow-hidden rounded-(--radius-element) border border-(--admin-border) bg-(--admin-surface)"
        style={{ aspectRatio: `${bounds.width} / ${bounds.height}` }}
      >
        <div className="absolute border-2 border-dashed border-(--admin-text-muted)" style={getBoxStyle(originalRect)} />
        <div
          className="absolute border-2 border-(--color-info) bg-(--color-info-muted)"
          style={{ ...getBoxStyle(proposedRect), transform: edit.rotation ? `rotate(${edit.rotation}deg)` : undefined }}
        />
      </div>
      <figcaption className="flex flex-col gap-1">
        <p className="font-mono text-xs text-(--admin-text-muted)">{getElementLabel(edit.target)}</p>
        <p>
          <span className="text-(--admin-text-sub)">변경 </span>
          {change}
        </p>
        <p className="text-xs text-(--admin-text-muted)">
          원래 {formatRect(originalRect)} → 제안 {formatRect(proposedRect)}
        </p>
        {edit.note ? <p>{edit.note}</p> : null}
        <p className="flex gap-3 text-xs">
          <span className="text-(--admin-text-muted)">점선: 원래 위치</span>
          <span className="text-(--color-text-info)">파란 칸: 제안 위치</span>
        </p>
      </figcaption>
    </figure>
  );
}
