import { getClarificationFieldLabel } from '@/lib/clarification-slots';
import type { FeedbackClarification } from '@/types/feedback';

// The AI's questions are inference and the answers are the reporter's words; both are labelled as such so
// neither reads as something the SDK observed.
export function ClarificationList({ clarification }: { clarification: FeedbackClarification }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-(--admin-text-sub)">보내기 전에 AI가 물어본 질문과 고객의 답변이에요. 질문은 AI가 만든 것이고 사실로 확인된 내용이 아니에요.</p>
      <ol className="flex flex-col gap-2">
        {clarification.questions.map((item, index) => (
          <li key={item.question} className="flex gap-3 rounded-(--radius-container) bg-(--admin-surface-sub) p-3">
            <span className="widget-mark-number shrink-0">{index + 1}</span>
            <div className="min-w-0">
              <p className="text-xs text-(--admin-text-muted)">
                <span className="font-semibold text-(--admin-text-sub)">{getClarificationFieldLabel(item.slot)}</span> · AI 질문
              </p>
              <p>{item.question}</p>
              <p className="mt-2 text-xs text-(--admin-text-muted)">고객 답변</p>
              {item.answer === null ? (
                <p className="text-(--admin-text-sub)">건너뜀 (선택지: {item.options.join(' / ')})</p>
              ) : (
                <p className="font-semibold">{item.answer}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="font-mono text-xs text-(--admin-text-muted)">모델: {clarification.model}</p>
    </div>
  );
}
