import { MAX_COMMENT_LENGTH, MAX_COMMENTS, MAX_EDITS, truncateText } from '@/lib/feedback-limits';
import type { CapturePolicy } from '@/lib/capture-policy';
import type { CommentPinSource } from '@/sdk/comment-pins';
import { findCaptureTarget, isCapturePageAllowed, type CaptureTarget } from '@/sdk/capture-policy';
import { createCaptureStatus } from '@/sdk/capture-status';
import { startElementDrag } from '@/sdk/element-drag';
import { startElementSelection } from '@/sdk/element-selection';
import { createFlowRecorder, type FlowRecorder, type FlowRecorderState } from '@/sdk/flow-recorder';
import { clearFlowSession, findSessionStorage, getFlowSessionKey } from '@/sdk/flow-session';
import type { AttachmentKind, CaptureCommand, CaptureMode, CaptureState } from '@/types/sdk-message';
import type { ElementTarget, FeedbackAttachments, FlowAttachment } from '@/types/feedback';

export interface CaptureControllerOptions {
  projectKey: string;
  policy: CapturePolicy | null;
  root: ShadowRoot;
  onUpdate: (state: CaptureState) => void;
  onShowWidget: () => void;
  onHideWidget: () => void;
}

const CAPTURE_DISABLED_MESSAGE = '이 사이트에서는 화면 맥락 첨부가 설정되지 않았습니다.';
const PAGE_NOT_ALLOWED_MESSAGE = '이 페이지에서는 화면 맥락을 첨부할 수 없습니다.';
const COMMENT_LIMIT_MESSAGE = `Comment는 최대 ${MAX_COMMENTS}개까지 첨부할 수 있습니다.`;
const EDIT_LIMIT_MESSAGE = `Edit는 최대 ${MAX_EDITS}개까지 첨부할 수 있습니다.`;
const FLOW_LIMIT_MESSAGE = 'Flow는 하나만 첨부할 수 있습니다. 기존 Flow를 삭제한 뒤 다시 기록하세요.';
const FLOW_ACTIVE_MESSAGE = 'Flow 기록을 먼저 종료하거나 취소하세요.';
const COMMENT_TARGET_MISSING_MESSAGE = '의견을 남길 요소를 먼저 선택하세요.';

function createEmptyAttachments(): FeedbackAttachments {
  return { comments: [], edits: [], flow: null };
}

export function createCaptureController(options: CaptureControllerOptions) {
  const { policy } = options;
  let attachments = createEmptyAttachments();
  let activeMode: CaptureMode | null = null;
  let selection: ElementTarget | null = null;
  let selectionElement: HTMLElement | null = null;
  // The live element of each comment, in the same order as attachments.comments, so saved screens can pin them.
  let commentElements: HTMLElement[] = [];
  // A key per comment that never changes, unlike its number, so saved screens can tell comments apart.
  let commentKeys: string[] = [];
  let nextCommentKey = 1;
  let isDragging = false;
  let transientHandle: { cancel(): void } | null = null;
  // Bumped whenever a transient run ends, so callbacks fired by our own cancel() (drag calls onCancel synchronously) are ignored.
  let transientToken = 0;
  let flowRecorder: FlowRecorder | null = null;
  let flowEventCount = 0;
  let flowErrorMessage: string | null = null;
  let controllerErrorMessage: string | null = null;
  let isPanelVisible = false;
  let isDestroyed = false;
  const status = createCaptureStatus({ root: options.root, onStop: () => flowRecorder?.stop(), onCancel: cancelActiveMode, onShow: showWidget });

  function getState(): CaptureState {
    return {
      enabled: isCapturePageAllowed(policy), activeMode, selection, flowEventCount,
      attachments: { comments: [...attachments.comments], edits: [...attachments.edits], flow: attachments.flow },
      errorMessage: controllerErrorMessage ?? flowErrorMessage,
    };
  }

  function renderStatus(): void {
    status.render(getState(), activeMode !== null && !isPanelVisible && !isDragging);
  }

  function emit(): void {
    if (isDestroyed) return;
    renderStatus();
    options.onUpdate(getState());
  }

  function showWidget(): void {
    isPanelVisible = true;
    renderStatus();
    options.onShowWidget();
  }

  function hideWidget(): void {
    isPanelVisible = false;
    options.onHideWidget();
  }

  function endTransientMode(): void {
    transientToken += 1;
    const handle = transientHandle;
    transientHandle = null;
    handle?.cancel();
    selection = null;
    selectionElement = null;
    isDragging = false;
    if (activeMode === 'comment' || activeMode === 'edit') activeMode = null;
  }

  function finishTransientRun(token: number): void {
    if (token !== transientToken || isDestroyed) return;
    endTransientMode();
    emit();
    showWidget();
  }

  function handleSelect(target: CaptureTarget, token: number): void {
    if (token !== transientToken || isDestroyed) return;
    transientHandle = null;
    if (activeMode === 'comment') {
      selection = target.target;
      selectionElement = target.element;
      emit();
      showWidget();
      return;
    }
    isDragging = true;
    emit();
    const handle = startElementDrag(target, {
      onComplete: (edit) => {
        if (token === transientToken && attachments.edits.length < MAX_EDITS) attachments.edits.push(edit);
        finishTransientRun(token);
      },
      onCancel: () => finishTransientRun(token),
    });
    if (token === transientToken) transientHandle = handle;
  }

  function findStartError(mode: CaptureMode): string | null {
    if (!policy || !flowRecorder) return CAPTURE_DISABLED_MESSAGE;
    if (!isCapturePageAllowed(policy)) return PAGE_NOT_ALLOWED_MESSAGE;
    if (activeMode === 'flow') return FLOW_ACTIVE_MESSAGE;
    if (mode === 'comment' && attachments.comments.length >= MAX_COMMENTS) return COMMENT_LIMIT_MESSAGE;
    if (mode === 'edit' && attachments.edits.length >= MAX_EDITS) return EDIT_LIMIT_MESSAGE;
    if (mode === 'flow' && attachments.flow) return FLOW_LIMIT_MESSAGE;
    return null;
  }

  function startMode(mode: CaptureMode): void {
    controllerErrorMessage = findStartError(mode);
    if (controllerErrorMessage) return emit();
    endTransientMode();
    hideWidget();
    if (mode === 'flow') {
      flowRecorder?.start();
      return emit();
    }
    const token = transientToken;
    activeMode = mode;
    emit();
    const handle = startElementSelection({
      findTarget: (eventTarget) => findCaptureTarget(eventTarget, policy),
      onSelect: (target) => handleSelect(target, token),
      onCancel: () => finishTransientRun(token),
    });
    if (token === transientToken) transientHandle = handle;
  }

  function addComment(comment: string): void {
    const trimmedComment = truncateText(comment.trim(), MAX_COMMENT_LENGTH);
    if (activeMode !== 'comment' || !selection || !selectionElement) {
      controllerErrorMessage = COMMENT_TARGET_MISSING_MESSAGE;
    } else if (trimmedComment) {
      if (attachments.comments.length < MAX_COMMENTS) {
        attachments.comments.push({ target: selection, comment: trimmedComment });
        commentElements.push(selectionElement);
        commentKeys.push(`comment-${nextCommentKey}`);
        nextCommentKey += 1;
      }
      controllerErrorMessage = null;
      endTransientMode();
    }
    emit();
  }

  function removeAttachment(kind: AttachmentKind, index: number): void {
    if (kind === 'flow') attachments.flow = null;
    else attachments[kind].splice(index, 1);
    if (kind === 'comments') {
      commentElements.splice(index, 1);
      commentKeys.splice(index, 1);
    }
    emit();
  }

  function cancelTransient(): void {
    if (activeMode === 'comment' || activeMode === 'edit') {
      endTransientMode();
      emit();
    }
  }

  function cancelActiveMode(): void {
    if (activeMode === 'flow') flowRecorder?.cancel();
    else cancelTransient();
  }

  function resetCapture(): void {
    endTransientMode();
    if (activeMode === 'flow') flowRecorder?.cancel();
    attachments = createEmptyAttachments();
    commentElements = [];
    commentKeys = [];
    controllerErrorMessage = null;
    emit();
  }

  function destroyCapture(): void {
    endTransientMode();
    isDestroyed = true;
    flowRecorder?.destroy();
    const storage = flowRecorder ? null : findSessionStorage();
    if (storage) clearFlowSession(storage, getFlowSessionKey(options.projectKey));
    flowRecorder = null;
    status.destroy();
  }

  function handleCommand(command: CaptureCommand): void {
    switch (command.type) {
      case 'capture:start':
        return startMode(command.payload.mode);
      case 'capture:cancel':
        return cancelActiveMode();
      case 'flow:stop':
        return flowRecorder?.stop();
      case 'comment:add':
        return addComment(command.payload.comment);
      case 'attachment:remove':
        return removeAttachment(command.payload.kind, command.payload.index);
      case 'draft:reset':
        return resetCapture();
      default: {
        const unhandled: never = command;
        return unhandled;
      }
    }
  }

  function handleFlowState(state: FlowRecorderState): void {
    if (isDestroyed) return;
    flowEventCount = state.eventCount;
    flowErrorMessage = state.errorMessage;
    if (state.recording && activeMode !== 'flow') {
      endTransientMode();
      activeMode = 'flow';
    } else if (!state.recording && activeMode === 'flow') {
      activeMode = null;
      queueMicrotask(emit);
      return;
    }
    emit();
  }

  function handleFlowComplete(flow: FlowAttachment): void {
    if (isDestroyed) return;
    attachments.flow = flow;
    emit();
    showWidget();
  }

  if (policy) {
    const allowedTargetIds = new Set(policy.targets.map((target) => target.id));
    flowRecorder = createFlowRecorder({
      projectKey: options.projectKey,
      isPathAllowed: (path) => policy.allowedPaths.includes(path),
      isTargetAllowed: (id) => allowedTargetIds.has(id),
      isPageAllowed: () => isCapturePageAllowed(policy),
      findTarget: (eventTarget) => findCaptureTarget(eventTarget, policy)?.target ?? null,
      onComplete: handleFlowComplete,
      onStateChange: handleFlowState,
    });
  }

  function unlessDestroyed<TArguments extends unknown[]>(action: (...args: TArguments) => void): (...args: TArguments) => void {
    return (...args) => { if (!isDestroyed) action(...args); };
  }

  // Only comments written on the current page are pinned: a persistent header element is still
  // connected after an SPA navigation, but its comment belongs to the earlier page.
  function getCommentPinSources(): CommentPinSource[] {
    return attachments.comments.flatMap(({ target, comment }, index) => {
      if (target.pagePath !== undefined && target.pagePath !== window.location.pathname) {
        return [];
      }
      const label = target.feedbackId ?? target.tagName.toLowerCase();
      return [{ number: index + 1, key: commentKeys[index], label, comment, element: commentElements[index] }];
    });
  }

  return {
    getCommentPinSources,
    handleCommand: unlessDestroyed(handleCommand),
    sync: emit,
    setPanelVisible: unlessDestroyed((visible: boolean) => {
      isPanelVisible = visible;
      renderStatus();
    }),
    pageChanged: unlessDestroyed(() => {
      cancelTransient();
      flowRecorder?.recordNavigation();
      emit();
    }),
    cancelTransient: unlessDestroyed(cancelTransient),
    reset: unlessDestroyed(resetCapture),
    destroy: unlessDestroyed(destroyCapture),
  };
}
