import { formatOffset } from '@/lib/feedback-display';
import type { FlowAttachment, FlowEventType } from '@/types/feedback';

const EVENT_LABELS: Record<FlowEventType, string> = {
  click: '클릭',
  navigation: '화면 이동',
  input: '입력',
};

export function FlowTimeline({ flow }: { flow: FlowAttachment }) {
  return (
    <div className="flex flex-col gap-2">
      {flow.truncated ? <p className="text-xs text-(--admin-warning)">기록이 길어서 일부만 저장됐어요.</p> : null}
      {flow.interrupted ? <p className="text-xs text-(--admin-warning)">기록이 중간에 끊겼어요.</p> : null}
      {flow.events.length === 0 ? (
        <p className="text-(--admin-text-muted)">기록된 동작이 없어요.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {flow.events.map((event, index) => (
            <li key={`${event.offsetMs}-${index}`} className="flex items-baseline gap-3 rounded-lg bg-(--admin-surface-sub) px-3 py-2">
              <span className="w-14 shrink-0 font-mono text-xs text-(--admin-text-muted)">{formatOffset(event.offsetMs)}</span>
              <span className="w-16 shrink-0 font-semibold">{EVENT_LABELS[event.type]}</span>
              <span className="min-w-0 truncate text-(--admin-text-sub)">
                {event.path}
                {event.targetLabel ? ` · ${event.targetLabel}` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
