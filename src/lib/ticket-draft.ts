// Turns a feedback into a ticket draft the admin can paste into an issue tracker. It restates what the
// reporter wrote and what the SDK recorded, kept apart, and never guesses a cause.
import { describeMove, formatSignedPixels } from '@/lib/edit-comparison-geometry';
import { FEEDBACK_TYPE_LABELS, formatDateTime, getElementLabel, getPagePath } from '@/lib/feedback-display';
import type { FeedbackDetailResponse, FlowAttachment, FlowEvent } from '@/types/feedback';

const MAX_TITLE_LENGTH = 60;
/** Steps listed in a draft. The rest of a longer recording is read in the admin screen. */
export const MAX_TICKET_FLOW_STEPS = 30;

export interface TicketDraft {
  title: string;
  /** Markdown. */
  body: string;
}

export interface TicketFlowSteps {
  steps: string[];
  /** Recorded events left out of the draft because the recording is long. */
  omittedCount: number;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// One line with Markdown punctuation escaped: text the reporter or the host page supplied stays plain text
// and cannot add a line or a link of its own.
function plain(text: string): string {
  return collapseWhitespace(text).replace(/[\\\x60*_[\]<>#|~]/g, '\\$&');
}

// Quoted line by line, so a reporter's line that starts with # or - stays the reporter's words.
function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function code(text: string): string {
  return `\`${collapseWhitespace(text).replaceAll('`', "'")}\``;
}

function createTitle(message: string, typeLabel: string): string {
  const firstLine = collapseWhitespace(message.split('\n').find((line) => line.trim() !== '') ?? '');
  const summary = firstLine.length > MAX_TITLE_LENGTH ? `${firstLine.slice(0, MAX_TITLE_LENGTH)}…` : firstLine;
  return `[${typeLabel}] ${summary}`;
}

function describeFlowStep(event: FlowEvent): string {
  const page = code(event.path);
  const target = event.targetLabel ? code(event.targetLabel) : '요소';
  if (event.type === 'click') {
    return `${page}에서 ${target} 클릭`;
  }
  if (event.type === 'input') {
    return `${page}에서 ${target}에 입력 (값은 기록하지 않음)`;
  }
  if (event.navigationType === 'reload') {
    return `${page} 새로고침`;
  }
  return `${page}(으)로 이동`;
}

/** The recorded actions of a Flow as reproduction steps, in order. */
export function summarizeFlowSteps(flow: FlowAttachment): TicketFlowSteps {
  const steps = flow.events.slice(0, MAX_TICKET_FLOW_STEPS).map(describeFlowStep);
  return { steps, omittedCount: flow.events.length - steps.length };
}

function createFlowSection(flow: FlowAttachment): string {
  const { steps, omittedCount } = summarizeFlowSteps(flow);
  const lines = steps.map((step, index) => `${index + 1}. ${step}`);
  if (omittedCount > 0) {
    lines.push(`- 이후 동작 ${omittedCount}개는 피드백 상세의 흐름 기록에서 확인하세요.`);
  }
  if (flow.truncated) {
    lines.push('- 기록이 길어서 일부만 저장됐습니다.');
  }
  if (flow.interrupted) {
    lines.push('- 기록이 중간에 끊겼습니다.');
  }
  return `## 재현 절차 (SDK가 기록한 동작)\n\n${lines.join('\n')}`;
}

/**
 * A ticket title and Markdown body for a feedback. adminOrigin is the address of this admin app, which the
 * links back to the feedback and its saved screens start with.
 */
export function createTicketDraft({ feedback, screenSnapshots }: FeedbackDetailResponse, adminOrigin: string): TicketDraft {
  const typeLabel = FEEDBACK_TYPE_LABELS[feedback.type];
  const projectQuery = `projectKey=${encodeURIComponent(feedback.projectKey)}`;
  const { comments, edits, flow } = feedback.attachments;
  const sections = [
    [
      '## 요약',
      '',
      `- 유형: ${typeLabel}`,
      `- 발생 화면: ${code(getPagePath(feedback.page.url))}`,
      `- 작성자: ${plain(feedback.reporter.name)}`,
      `- 접수: ${formatDateTime(feedback.createdAt)}`,
      `- 화면 크기: ${feedback.page.viewportWidth}×${feedback.page.viewportHeight}`,
      `- 피드백 원문: ${adminOrigin}/admin/feedback/${encodeURIComponent(feedback.id)}?${projectQuery}`,
    ].join('\n'),
    `## 사용자 진술\n\n${quote(feedback.message)}`,
  ];
  if (flow && flow.events.length > 0) {
    sections.push(createFlowSection(flow));
  }
  if (comments.length > 0) {
    const lines = comments.map(({ target, comment }, index) => `${index + 1}. ${code(getElementLabel(target))}: ${plain(comment)}`);
    sections.push(`## 가리킨 위치와 의견 (사용자 진술)\n\n${lines.join('\n')}`);
  }
  if (edits.length > 0) {
    const lines = edits.map((edit, index) => {
      const move = describeMove(edit.originalRect, edit.proposedRect);
      const note = plain(edit.note);
      const moved = `가로 ${formatSignedPixels(move.deltaX)}, 세로 ${formatSignedPixels(move.deltaY)}`;
      return `${index + 1}. ${code(getElementLabel(edit.target))}: ${moved}${note ? ` (${note})` : ''}`;
    });
    lines.push('- 좌표 이동은 변경 요청을 나타내며 실제 레이아웃 코드 수정과 같지 않습니다.');
    sections.push(`## 위치 변경 제안\n\n${lines.join('\n')}`);
  }
  if (screenSnapshots.length > 0) {
    const lines = screenSnapshots.map((screen, index) => {
      const label = `화면 ${index + 1}: ${plain(getPagePath(screen.page.url))} · ${formatDateTime(screen.capturedAt)}`;
      const missing = screen.missingAssets.length > 0 ? ` (빠진 파일 ${screen.missingAssets.length}개)` : '';
      return `- [${label}](${adminOrigin}/admin/snapshots/${encodeURIComponent(screen.id)}?${projectQuery})${missing}`;
    });
    sections.push(`## 저장된 화면\n\n${lines.join('\n')}`);
  }
  sections.push('## 확인되지 않은 사항\n\n- 원인은 확인되지 않았습니다. 위 내용은 사용자 진술과 SDK 기록이며, 재현 여부는 담당자가 확인해야 합니다.');
  return { title: createTitle(feedback.message, typeLabel), body: sections.join('\n\n') };
}
