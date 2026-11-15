import type { TicketStatus } from '@/hooks/useCreateTicket';

interface FeedbackTicketPanelProps {
  status: TicketStatus;
  url: string;
  errorMessage: string;
  onCreate: () => void;
}

export function FeedbackTicketPanel({ status, url, errorMessage, onCreate }: FeedbackTicketPanelProps) {
  const isCreating = status === 'creating';

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-(--admin-border) bg-(--admin-surface) p-4">
      <h2 className="text-base font-bold">개발 티켓</h2>
      <p className="text-(--admin-text-sub)">이 피드백을 노션 티켓 보드에 새 티켓으로 올려요.</p>

      {status === 'created' ? (
        <p role="status" className="rounded-xl bg-(--admin-success-weak) p-3 text-(--admin-success)">
          티켓을 만들었어요.{' '}
          <a href={url} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
            노션에서 열기
          </a>
        </p>
      ) : (
        <button
          type="button"
          onClick={onCreate}
          disabled={isCreating}
          className="min-h-11 rounded-[10px] bg-(--admin-primary) px-5 font-semibold text-white hover:bg-(--admin-primary-hover) disabled:opacity-50"
        >
          {isCreating ? '만드는 중…' : '노션 티켓 만들기'}
        </button>
      )}

      {status === 'failed' ? (
        <p role="alert" className="text-sm text-(--admin-danger)">
          {errorMessage}
        </p>
      ) : null}
    </section>
  );
}
