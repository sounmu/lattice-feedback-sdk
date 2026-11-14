import { describeMove, formatRect, formatSignedPixels, getComparisonBounds } from '@/lib/edit-comparison-geometry';
import { getElementLabel } from '@/lib/feedback-display';
import type { EditAttachment } from '@/types/feedback';

/** Draws the original and proposed boxes on a scaled page outline, so the move is visible at a glance. */
export function EditComparison({ edit }: { edit: EditAttachment }) {
  const { originalRect, proposedRect } = edit;
  const bounds = getComparisonBounds(edit.viewportWidth, edit.viewportHeight, [originalRect, proposedRect]);
  const move = describeMove(originalRect, proposedRect);

  function getBoxStyle(rect: EditAttachment['originalRect']) {
    return {
      left: `${(rect.x / bounds.width) * 100}%`,
      top: `${(rect.y / bounds.height) * 100}%`,
      width: `${(rect.width / bounds.width) * 100}%`,
      height: `${(rect.height / bounds.height) * 100}%`,
    };
  }

  return (
    <figure className="flex flex-col gap-2 rounded-xl bg-(--admin-surface-sub) p-3">
      <div
        role="img"
        aria-label={`${getElementLabel(edit.target)} 위치 변경: 가로 ${formatSignedPixels(move.deltaX)}, 세로 ${formatSignedPixels(move.deltaY)}`}
        className="relative w-full overflow-hidden rounded-lg border border-(--admin-border) bg-(--admin-surface)"
        style={{ aspectRatio: `${bounds.width} / ${bounds.height}` }}
      >
        <div className="absolute border-2 border-dashed border-(--admin-text-muted)" style={getBoxStyle(originalRect)} />
        <div className="absolute border-2 border-(--admin-primary) bg-(--admin-primary-weak)" style={getBoxStyle(proposedRect)} />
      </div>
      <figcaption className="flex flex-col gap-1">
        <p className="font-mono text-xs text-(--admin-text-muted)">{getElementLabel(edit.target)}</p>
        <p>
          <span className="text-(--admin-text-sub)">이동 </span>
          가로 {formatSignedPixels(move.deltaX)}, 세로 {formatSignedPixels(move.deltaY)}
          {move.isResized ? ' · 크기도 바뀌었어요' : ''}
        </p>
        <p className="text-xs text-(--admin-text-muted)">
          원래 {formatRect(originalRect)} → 제안 {formatRect(proposedRect)}
        </p>
        {edit.note ? <p>{edit.note}</p> : null}
        <p className="flex gap-3 text-xs">
          <span className="text-(--admin-text-muted)">점선: 원래 위치</span>
          <span className="text-(--admin-primary)">파란 칸: 제안 위치</span>
        </p>
      </figcaption>
    </figure>
  );
}
