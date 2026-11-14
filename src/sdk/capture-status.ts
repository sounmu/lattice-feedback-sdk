// Host-page status bar for an active capture mode, rendered inside the SDK ShadowRoot.
// It only shows configured text and counts; no host DOM text or attributes are read.
import { MAX_COMMENTS, MAX_EDITS, MAX_FLOW_EVENTS } from '@/lib/feedback-limits';
import { SDK_Z_INDEX } from '@/sdk/styles';
import type { CaptureMode, CaptureState } from '@/types/sdk-message';

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

const STATUS_STYLES = `
.capture-status {
  position: fixed;
  left: 20px;
  bottom: 80px;
  z-index: ${SDK_Z_INDEX};
  box-sizing: border-box;
  max-width: min(390px, calc(100vw - 40px));
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 8px 16px;
  border-radius: 12px;
  background: #111827;
  color: #ffffff;
  font: 500 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  box-shadow: 0 6px 20px rgba(17, 24, 39, 0.25);
}
.capture-status[hidden] {
  display: none;
}
.capture-status-label {
  flex: 1 1 160px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.capture-status-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.capture-status button {
  min-width: 44px;
  min-height: 44px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  background: #374151;
  color: #ffffff;
  font: 600 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  cursor: pointer;
}
.capture-status button:hover {
  background: #4b5563;
}
.capture-status button:focus-visible {
  outline: 2px solid #60a5fa;
  outline-offset: 2px;
}
.capture-status button[data-action="stop"] {
  background: #dc2626;
}
.capture-status button[hidden] {
  display: none;
}
`;

const STOP_LABEL = '기록 종료';
const FINISH_COMMENT_LABEL = '코멘트 완료';
const CANCEL_LABEL = '취소';
const SHOW_LABEL = '패널 열기';

function getStatusMessage(state: CaptureState, mode: CaptureMode): string {
  const commentCount = `(${state.attachments.comments.length}/${MAX_COMMENTS})`;
  switch (mode) {
    case 'comment':
      if (state.selection) {
        return `Comment: 선택한 위치에 의견을 입력하세요 ${commentCount}`;
      }
      return `Comment: 의견을 남길 요소를 클릭하세요 ${commentCount}`;
    case 'edit':
      return `Edit: 위치를 바꿀 요소를 클릭하세요 (${state.attachments.edits.length}/${MAX_EDITS})`;
    case 'flow':
      if (!state.enabled) return 'Flow 일시중지 · 허용된 화면에서 기록을 이어갑니다.';
      return `Flow 기록 중 · 화면 내용과 변화 포함 · 이벤트 ${state.flowEventCount}/${MAX_FLOW_EVENTS}`;
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

export function createCaptureStatus(options: CaptureStatusOptions): CaptureStatus {
  const styleElement = document.createElement('style');
  styleElement.textContent = STATUS_STYLES;
  const container = document.createElement('div');
  container.className = 'capture-status';
  container.hidden = true;
  const label = document.createElement('span');
  label.className = 'capture-status-label';
  label.setAttribute('role', 'status');
  label.setAttribute('aria-live', 'polite');
  const actions = document.createElement('div');
  actions.className = 'capture-status-actions';
  const handleStop = (): void => options.onStop();
  const handleCancel = (): void => options.onCancel();
  const handleShow = (): void => options.onShow();
  const stopButton = createActionButton('stop', STOP_LABEL, handleStop);
  const cancelButton = createActionButton('cancel', CANCEL_LABEL, handleCancel);
  const showButton = createActionButton('show', SHOW_LABEL, handleShow);
  actions.append(stopButton, cancelButton, showButton);
  container.append(label, actions);
  options.root.append(styleElement, container);
  let isDestroyed = false;

  return {
    render(state: CaptureState, isVisible: boolean): void {
      if (isDestroyed) {
        return;
      }
      if (!isVisible || !state.activeMode) {
        container.hidden = true;
        return;
      }
      label.textContent = getStatusMessage(state, state.activeMode);
      if (state.errorMessage) label.textContent += ` · ${state.errorMessage}`;
      stopButton.hidden = state.activeMode === 'edit';
      stopButton.textContent = state.activeMode === 'comment' ? FINISH_COMMENT_LABEL : STOP_LABEL;
      container.hidden = false;
    },
    destroy(): void {
      if (isDestroyed) {
        return;
      }
      isDestroyed = true;
      stopButton.removeEventListener('click', handleStop);
      cancelButton.removeEventListener('click', handleCancel);
      showButton.removeEventListener('click', handleShow);
      container.remove();
      styleElement.remove();
    },
  };
}
