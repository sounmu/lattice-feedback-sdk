import { CLARIFICATION_SLOTS, FEEDBACK_DETAIL_SOURCE_LABELS } from '@/lib/clarification-slots';
import type { FeedbackDetail } from '@/types/feedback';

// The fields a developer needs, each with where its value came from, so a reporter's words never read as
// something the SDK recorded and an empty field stands out.
export function FeedbackDetailList({ details }: { details: FeedbackDetail[] }) {
  return (
    <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2">
      {details.map(({ slot, source, value }) => (
        <div key={slot} className="contents">
          <dt className="text-(--admin-text-muted)">{CLARIFICATION_SLOTS[slot].label}</dt>
          <dd className="min-w-0">
            {value === null ? (
              <span className="text-(--admin-text-muted)">{FEEDBACK_DETAIL_SOURCE_LABELS.missing}</span>
            ) : (
              <>
                <span className="break-words">{value}</span>{' '}
                <span className="whitespace-nowrap text-xs text-(--admin-text-muted)">· {FEEDBACK_DETAIL_SOURCE_LABELS[source]}</span>
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
