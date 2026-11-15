// Host-page mode bar for an active capture mode, rendered inside the SDK ShadowRoot.
// It only shows configured text and counts; no host DOM text or attributes are read.
import { MAX_COMMENTS, MAX_EDITS, MAX_FLOW_EVENTS } from '@/lib/feedback-limits';
import { getStatusActions, getStatusPhase, type StatusPhase } from '@/sdk/capture-status-model';
import { SDK_Z_INDEX } from '@/sdk/styles';
import type { CaptureState } from '@/types/sdk-message';

export interface CaptureStatusOptions {
  root: ShadowRoot;
  onStop: () => void;
  onCancel: () => void;
  onShow: () => void;
}

export interface CaptureStatus {
  render(state: CaptureState, isVisible: boolean): void;
  destroy(): void;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const STATUS_STYLES = `
.capture-status {
  position: fixed;
  left: 20px;
  bottom: 80px;
  z-index: ${SDK_Z_INDEX};
  box-sizing: border-box;
  width: min(400px, calc(100vw - 40px));
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 14px;
  background: #111827;
  color: #ffffff;
  font: 400 14px/1.45 ${FONT};
  box-shadow: 0 8px 28px rgba(17, 24, 39, 0.35);
  outline: none;
}
.capture-status[hidden] { display: none; }
.capture-status:focus-visible { box-shadow: 0 0 0 3px #93c5fd, 0 8px 28px rgba(17, 24, 39, 0.35); }
.capture-status-head { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; }
.capture-status-dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: #60a5fa; }
.capture-status-dot.is-recording {
  background: #e5484d;
  box-shadow: 0 0 0 4px rgba(229, 72, 77, 0.3);
  animation: capture-status-pulse 1.1s ease-in-out infinite;
}
.capture-status-count { margin-left: auto; font-size: 13px; font-weight: 500; color: #d1d5db; font-variant-numeric: tabular-nums; }
.capture-status-label { margin: 0; overflow-wrap: anywhere; }
.capture-status-collects { margin: 0; font-size: 12px; color: #d1d5db; overflow-wrap: anywhere; }
.capture-status-error { margin: 0; font-size: 13px; color: #fca5a5; overflow-wrap: anywhere; }
.capture-status-error[hidden] { display: none; }
.capture-status-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.capture-status button {
  min-width: 44px;
  min-height: 44px;
  padding: 0 14px;
  border: 0;
  border-radius: 10px;
  background: #374151;
  color: #ffffff;
  font: 600 14px/1 ${FONT};
  cursor: pointer;
}
.capture-status button:hover { background: #4b5563; }
.capture-status button:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; }
.capture-status button[data-action="stop"] { background: #e5e7eb; color: #111827; }
.capture-status button[data-action="stop"]:hover { background: #f3f4f6; }
.capture-status button[data-action="stop"].is-recording { background: #e5484d; color: #ffffff; }
.capture-status button[data-action="stop"].is-recording:hover { background: #d1343a; }
.capture-status button[hidden] { display: none; }
.capture-recording-frame {
  position: fixed;
  inset: 0;
  z-index: ${SDK_Z_INDEX - 2};
  box-sizing: border-box;
  border: 3px solid rgba(229, 72, 77, 0.85);
  pointer-events: none;
}
.capture-recording-frame[hidden] { display: none; }
@keyframes capture-status-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
@media (prefers-reduced-motion: reduce) {
  .capture-status-dot.is-recording { animation: none; }
}
`;

const REGION_LABEL = '피드백 도구';
const SHOW_LABEL = '피드백 창 열기';
const ESCAPE_HINT = 'Esc 키로 취소';
const ATTACHED_NOTICE_MS = 4000;

const MODE_TITLES: Record<StatusPhase, string> = {
  'comment-pick': '요소 코멘트',
  'comment-write': '요소 코멘트',
  'edit-pick': '위치 편집',
  'edit-drag': '위치 편집',
  'flow-recording': '흐름 기록 중',
  'flow-paused': '흐름 기록 잠시 멈춤',
};

const INSTRUCTIONS: Record<StatusPhase, string> = {
  'comment-pick': '페이지에서 요소를 클릭하세요. 클릭해도 원래 버튼은 실행되지 않아요.',
  'comment-write': '고른 자리에 의견을 적고 코멘트 첨부를 눌러 주세요.',
  'edit-pick': '옮길 요소를 클릭하세요. 클릭해도 원래 버튼은 실행되지 않아요.',
  'edit-drag': '끌어서 옮긴 뒤 변경 첨부를 눌러 주세요. 방향키로도 옮길 수 있어요.',
  'flow-recording': '평소처럼 페이지를 사용하다가 문제가 나면 기록을 종료하세요.',
  'flow-paused': '이 페이지는 기록하지 않아요. 허용된 화면으로 돌아가면 이어서 기록해요.',
};

const COMMENT_COLLECTS = '저장: 고른 요소의 위치와 적은 의견';
const EDIT_COLLECTS = '저장: 요소의 원래 위치와 옮긴 위치 · 실제 화면은 바뀌지 않아요';
const FLOW_COLLECTS = '기록: 클릭·입력·화면 이동과 화면 변화 · 입력한 값은 가려요';
const COLLECTS: Record<StatusPhase, string> = {
  'comment-pick': COMMENT_COLLECTS,
  'comment-write': COMMENT_COLLECTS,
  'edit-pick': EDIT_COLLECTS,
  'edit-drag': EDIT_COLLECTS,
  'flow-recording': FLOW_COLLECTS,
  'flow-paused': FLOW_COLLECTS,
};

const FINISH_LABELS = { neutral: '선택 마치기', recording: '기록 종료 및 첨부' } as const;
const CANCEL_LABELS = { transient: '취소', recording: '기록 취소' } as const;

function describeAttachedComments(count: number): string {
  return `코멘트 ${count}개를 첨부했어요. 계속 고르거나 선택을 마치세요.`;
}

function getCount(state: CaptureState, phase: StatusPhase): string {
  switch (phase) {
    case 'comment-pick':
    case 'comment-write':
      return `${state.attachments.comments.length}/${MAX_COMMENTS}`;
    case 'edit-pick':
    case 'edit-drag':
      return `${state.attachments.edits.length}/${MAX_EDITS}`;
    case 'flow-recording':
    case 'flow-paused':
      return `이벤트 ${state.flowEventCount}/${MAX_FLOW_EVENTS}`;
  }
}

function createActionButton(action: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.action = action;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function createLine(className: string): HTMLParagraphElement {
  const line = document.createElement('p');
  line.className = className;
  return line;
}

export function createCaptureStatus(options: CaptureStatusOptions): CaptureStatus {
  const styleElement = document.createElement('style');
  styleElement.textContent = STATUS_STYLES;
  const frame = document.createElement('div');
  frame.className = 'capture-recording-frame';
  frame.setAttribute('aria-hidden', 'true');
  frame.hidden = true;
  const container = document.createElement('div');
  container.className = 'capture-status';
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', REGION_LABEL);
  container.tabIndex = -1;
  container.hidden = true;
  const head = document.createElement('div');
  head.className = 'capture-status-head';
  const dot = document.createElement('span');
  dot.className = 'capture-status-dot';
  dot.setAttribute('aria-hidden', 'true');
  const title = document.createElement('span');
  title.className = 'capture-status-title';
  const count = document.createElement('span');
  count.className = 'capture-status-count';
  head.append(dot, title, count);
  const label = createLine('capture-status-label');
  label.setAttribute('role', 'status');
  label.setAttribute('aria-live', 'polite');
  const collects = createLine('capture-status-collects');
  const error = createLine('capture-status-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const actions = document.createElement('div');
  actions.className = 'capture-status-actions';
  const handleStop = (): void => options.onStop();
  const handleCancel = (): void => options.onCancel();
  const handleShow = (): void => options.onShow();
  const stopButton = createActionButton('stop', FINISH_LABELS.neutral, handleStop);
  const cancelButton = createActionButton('cancel', CANCEL_LABELS.transient, handleCancel);
  const showButton = createActionButton('show', SHOW_LABEL, handleShow);
  actions.append(stopButton, cancelButton, showButton);
  container.append(head, label, collects, error, actions);
  options.root.append(styleElement, frame, container);
  let isDestroyed = false;
  let isShown = false;
  let previousCommentCount = 0;
  let notice: string | null = null;
  let noticeTimer: number | null = null;
  let lastRender: { state: CaptureState; isVisible: boolean } | null = null;

  function clearNotice(): void {
    notice = null;
    if (noticeTimer !== null) {
      window.clearTimeout(noticeTimer);
      noticeTimer = null;
    }
  }

  function showNotice(text: string): void {
    clearNotice();
    notice = text;
    noticeTimer = window.setTimeout(() => {
      noticeTimer = null;
      notice = null;
      if (lastRender) render(lastRender.state, lastRender.isVisible);
    }, ATTACHED_NOTICE_MS);
  }

  function hide(): void {
    container.hidden = true;
    frame.hidden = true;
    isShown = false;
    clearNotice();
  }

  function render(state: CaptureState, isVisible: boolean): void {
    if (isDestroyed) {
      return;
    }
    lastRender = { state, isVisible };
    const phase = getStatusPhase(state);
    const commentCount = state.attachments.comments.length;
    // The bar blinks off between an attached comment and the mode restarting, so the count it compares
    // against is only taken from renders it was shown in.
    if (!isVisible || !phase) {
      hide();
      return;
    }
    const { finish, isRecording, escapeCancels } = getStatusActions(phase);
    if (phase === 'comment-pick' && commentCount > previousCommentCount) {
      showNotice(describeAttachedComments(commentCount));
    }
    previousCommentCount = commentCount;
    title.textContent = MODE_TITLES[phase];
    count.textContent = getCount(state, phase);
    dot.classList.toggle('is-recording', phase === 'flow-recording');
    label.textContent = notice ?? INSTRUCTIONS[phase];
    collects.textContent = escapeCancels ? `${COLLECTS[phase]} · ${ESCAPE_HINT}` : COLLECTS[phase];
    error.textContent = state.errorMessage ?? '';
    error.hidden = !state.errorMessage;
    stopButton.hidden = finish === 'hidden';
    stopButton.textContent = finish === 'recording' ? FINISH_LABELS.recording : FINISH_LABELS.neutral;
    stopButton.classList.toggle('is-recording', isRecording);
    cancelButton.textContent = isRecording ? CANCEL_LABELS.recording : CANCEL_LABELS.transient;
    frame.hidden = phase !== 'flow-recording';
    container.hidden = false;
    if (!isShown) {
      isShown = true;
      container.focus({ preventScroll: true });
    }
  }

  return {
    render,
    destroy(): void {
      if (isDestroyed) {
        return;
      }
      isDestroyed = true;
      clearNotice();
      stopButton.removeEventListener('click', handleStop);
      cancelButton.removeEventListener('click', handleCancel);
      showButton.removeEventListener('click', handleShow);
      container.remove();
      frame.remove();
      styleElement.remove();
    },
  };
}
