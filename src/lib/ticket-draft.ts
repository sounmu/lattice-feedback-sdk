import { describeMove, formatRect, formatSignedPixels } from '@/lib/edit-comparison-geometry';
import { FEEDBACK_STATUS_LABELS, FEEDBACK_TYPE_LABELS, formatDateTime, formatOffset, getElementLabel, getPagePath } from '@/lib/feedback-display';
import type { Feedback, FlowEventType } from '@/types/feedback';

/** A ticket as plain text, independent of the board it is sent to. */
export interface TicketDraft {
  title: string;
  sections: TicketSection[];
}

export interface TicketSection {
  heading: string;
  lines: string[];
}

const MAX_TITLE_LENGTH = 80;
const MAX_FLOW_LINES = 20;

const FLOW_EVENT_LABELS: Record<FlowEventType, string> = {
  click: '클릭',
  navigation: '화면 이동',
  input: '입력',
};

function createTitle(feedback: Feedback): string {
  const firstLine = feedback.message.split('\n')[0].trim();
  const prefix = `[${FEEDBACK_TYPE_LABELS[feedback.type]}] `;
  const room = MAX_TITLE_LENGTH - prefix.length;
  const summary = firstLine.length > room ? `${firstLine.slice(0, room - 1)}…` : firstLine;
  return `${prefix}${summary}`;
}

function createCommentLines(feedback: Feedback): string[] {
  return feedback.attachments.comments.map(
    (item, index) => `${index + 1}. ${item.comment} (${getElementLabel(item.target)})`,
  );
}

function createEditLines(feedback: Feedback): string[] {
  return feedback.attachments.edits.map((edit, index) => {
    const move = describeMove(edit.originalRect, edit.proposedRect);
    const resized = move.isResized ? ', 크기도 변경' : '';
    const note = edit.note ? ` — ${edit.note}` : '';
    return (
      `${index + 1}. ${getElementLabel(edit.target)}: 가로 ${formatSignedPixels(move.deltaX)}, ` +
      `세로 ${formatSignedPixels(move.deltaY)}${resized} (${formatRect(edit.originalRect)} → ${formatRect(edit.proposedRect)})${note}`
    );
  });
}

function createFlowLines(feedback: Feedback): string[] {
  const flow = feedback.attachments.flow;
  if (!flow) {
    return [];
  }
  const lines = flow.events.slice(0, MAX_FLOW_LINES).map((event) => {
    const target = event.targetLabel ? ` · ${event.targetLabel}` : '';
    return `${formatOffset(event.offsetMs)} ${FLOW_EVENT_LABELS[event.type]} ${event.path}${target}`;
  });
  if (flow.events.length > MAX_FLOW_LINES) {
    lines.push(`… 외 ${flow.events.length - MAX_FLOW_LINES}개 (관리자 화면에서 전체 확인)`);
  }
  return lines;
}

interface TicketDraftInput {
  feedback: Feedback;
  /** Link to the feedback in the admin console, so the ticket leads back to the saved screens. */
  adminUrl: string;
}

export function buildTicketDraft({ feedback, adminUrl }: TicketDraftInput): TicketDraft {
  const sections: TicketSection[] = [
    { heading: '요청 내용', lines: [feedback.message] },
    {
      heading: '정보',
      lines: [
        `유형: ${FEEDBACK_TYPE_LABELS[feedback.type]}`,
        `상태: ${FEEDBACK_STATUS_LABELS[feedback.status]}`,
        `접수: ${formatDateTime(feedback.createdAt)}`,
        `보낸 사람: ${feedback.reporter.name}`,
        `페이지: ${getPagePath(feedback.page.url)} (${feedback.page.title})`,
        `화면 크기: ${feedback.page.viewportWidth}×${feedback.page.viewportHeight}`,
      ],
    },
  ];

  const commentLines = createCommentLines(feedback);
  if (commentLines.length > 0) {
    sections.push({ heading: `코멘트 ${commentLines.length}개`, lines: commentLines });
  }
  const editLines = createEditLines(feedback);
  if (editLines.length > 0) {
    sections.push({ heading: `위치 편집 ${editLines.length}개`, lines: editLines });
  }
  const flowLines = createFlowLines(feedback);
  if (flowLines.length > 0) {
    sections.push({ heading: '흐름 기록', lines: flowLines });
  }
  sections.push({ heading: '관리자 화면', lines: [adminUrl] });

  return { title: createTitle(feedback), sections };
}
