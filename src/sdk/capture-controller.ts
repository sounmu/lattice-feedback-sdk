import { MAX_COMMENT_LENGTH, MAX_COMMENTS, MAX_EDITS, truncateText } from '@/lib/feedback-limits';
import { isGenericTargetLabel, type CapturePolicy } from '@/lib/capture-policy';
import type { CommentPinSource, EditMoveSource } from '@/sdk/screen-marks';
import { findCaptureTarget, findFlowTargetLabel, isCapturePageAllowed, type CaptureTarget } from '@/sdk/capture-policy';
import { createCommentOverlay } from '@/sdk/comment-overlay';
import { createCaptureStatus } from '@/sdk/capture-status';
import { startElementDrag } from '@/sdk/element-drag';
import { startElementSelection, type SelectionPoint } from '@/sdk/element-selection';
import { createFlowRecorder, type FlowRecorder, type FlowRecorderState } from '@/sdk/flow-recorder';
import { startReplayRecording, type ReplayRecorder, type ReplayRecording } from '@/sdk/flow-replay-recorder';
import { clearFlowSession, findSessionStorage, getFlowSessionKey } from '@/sdk/flow-session';
import type { AttachmentKind, CaptureCommand, CaptureMode, CaptureState } from '@/types/sdk-message';
import type { ElementTarget, FeedbackAttachments, FlowAttachment } from '@/types/feedback';

export interface CaptureControllerOptions {
  projectKey: string;
  policy: CapturePolicy | null;
  root: ShadowRoot;
  /** The SDK's own elements, left out of the Flow replay. */
  sdkSelector: string;
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
  let selectionPoint: SelectionPoint = { x: 0.5, y: 0.5 };
  // The live element of each comment, in the same order as attachments.comments, so saved screens can pin them.
  let commentElements: HTMLElement[] = [];
  // A key per comment and edit that never changes, unlike its number, so saved screens can tell them apart.
  let commentKeys: string[] = [];
  let editKeys: string[] = [];
  let nextMarkKey = 1;
  // Likewise for the dragged element of each edit.
  let editElements: HTMLElement[] = [];
  let commentPoints: SelectionPoint[] = [];
  let isDragging = false;
  let transientHandle: { cancel(): void } | null = null;
  // Bumped whenever a transient run ends, so callbacks fired by our own cancel() (drag calls onCancel synchronously) are ignored.
  let transientToken = 0;
  let flowRecorder: FlowRecorder | null = null;
  let flowEventCount = 0;
  // A Flow session identifies the replay across same-origin documents.
  let replayRecorder: ReplayRecorder | null = null;
  let finishedReplay: Promise<ReplayRecording | null> | null = null;
  // The recorder reports the stop before the completed Flow arrives, so the replay waits here until then.
  // A replay cut off on a page the policy leaves out waits here as well.
  let stoppedReplay: Promise<ReplayRecording | null> | null = null;
  let isStartingFlow = false;
  let flowErrorMessage: string | null = null;
  let controllerErrorMessage: string | null = null;
  let isPanelVisible = false;
  let isDestroyed = false;
  const commentOverlay = createCommentOverlay(options.root);
  const status = createCaptureStatus({
    root: options.root,
    onStop: () => {
      if (activeMode === 'flow') {
        flowRecorder?.stop();
      } else {
        cancelTransient();
        showWidget();
      }
    },
    onCancel: cancelActiveMode,
    onShow: showWidget,
  });

  function getState(): CaptureState {
    return {
      enabled: isCapturePageAllowed(policy), activeMode, selection, flowEventCount,
      attachments: { comments: [...attachments.comments], edits: [...attachments.edits], flow: attachments.flow },
      commentKeys: [...commentKeys],
      editKeys: [...editKeys],
      errorMessage: controllerErrorMessage ?? flowErrorMessage,
    };
  }

  function renderStatus(): void {
    status.render(getState(), activeMode !== null && !isPanelVisible && !isDragging);
  }

  function emit(): void {
    if (isDestroyed) return;
    commentOverlay.renderPins(getCommentPinSources(), (key) => {
      const index = commentKeys.indexOf(key);
      if (index >= 0) removeAttachment('comments', index);
    });
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
    commentOverlay.closeEditor();
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

  function handleSelect(target: CaptureTarget, token: number, point: SelectionPoint): void {
    if (token !== transientToken || isDestroyed) return;
    transientHandle = null;
    if (activeMode === 'comment') {
      selection = target.target;
      selectionElement = target.element;
      selectionPoint = point;
      emit();
      commentOverlay.openEditor(target, point, {
        onSubmit: (comment) => {
          if (token !== transientToken || isDestroyed) return;
          addComment(comment);
          if (attachments.comments.length < MAX_COMMENTS) startMode('comment');
          else showWidget();
        },
        onCancel: () => {
          if (token === transientToken && !isDestroyed) startMode('comment');
        },
      });
      return;
    }
    isDragging = true;
    emit();
    const handle = startElementDrag(target, {
      onComplete: (edit) => {
        if (token === transientToken && attachments.edits.length < MAX_EDITS) {
          attachments.edits.push(edit);
          editElements.push(target.element);
          editKeys.push(`edit-${nextMarkKey}`);
          nextMarkKey += 1;
        }
        finishTransientRun(token);
      },
      onCancel: () => finishTransientRun(token),
    });
    if (token === transientToken) transientHandle = handle;
  }

  function findStartError(mode: CaptureMode): string | null {
    if (!flowRecorder) return CAPTURE_DISABLED_MESSAGE;
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
      isStartingFlow = true;
      flowRecorder?.start();
      isStartingFlow = false;
      return emit();
    }
    const token = transientToken;
    activeMode = mode;
    emit();
    const handle = startElementSelection({
      findTarget: (eventTarget) => findCaptureTarget(eventTarget, policy),
      onSelect: (target, point) => handleSelect(target, token, point),
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
        commentKeys.push(`comment-${nextMarkKey}`);
        commentPoints.push(selectionPoint);
        nextMarkKey += 1;
      }
      controllerErrorMessage = null;
      endTransientMode();
    }
    emit();
  }

  function removeAttachment(kind: AttachmentKind, index: number): void {
    if (kind === 'flow') {
      attachments.flow = null;
      finishedReplay = null;
    }
    else attachments[kind].splice(index, 1);
    if (kind === 'comments') {
      commentElements.splice(index, 1);
      commentKeys.splice(index, 1);
      commentPoints.splice(index, 1);
    }
    if (kind === 'edits') {
      editElements.splice(index, 1);
      editKeys.splice(index, 1);
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
    if (activeMode === 'flow') {
      discardReplay();
      flowRecorder?.cancel();
      stoppedReplay = null;
    } else cancelTransient();
  }

  function resetCapture(): void {
    endTransientMode();
    discardReplay();
    if (activeMode === 'flow') flowRecorder?.cancel();
    attachments = createEmptyAttachments();
    finishedReplay = null;
    stoppedReplay = null;
    commentElements = [];
    editElements = [];
    commentKeys = [];
    editKeys = [];
    commentPoints = [];
    controllerErrorMessage = null;
    emit();
  }

  function destroyCapture(): void {
    endTransientMode();
    isDestroyed = true;
    discardReplay();
    finishedReplay = null;
    flowRecorder?.destroy();
    const storage = flowRecorder ? null : findSessionStorage();
    if (storage) clearFlowSession(storage, getFlowSessionKey(options.projectKey));
    flowRecorder = null;
    commentOverlay.destroy();
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
      if (state.sessionId) startReplay(state.sessionId, !isStartingFlow);
    } else if (!state.recording && activeMode === 'flow') {
      activeMode = null;
      // A replay that was cut off has no recorder left and is kept as it is.
      if (replayRecorder) {
        stoppedReplay = replayRecorder.stop();
        replayRecorder = null;
      }
      queueMicrotask(emit);
      return;
    }
    emit();
  }

  function startReplay(sessionId: string, resumed: boolean): void {
    discardReplay();
    finishedReplay = null;
    stoppedReplay = null;
    // On an excluded page, recover earlier segments without recording this document.
    replayRecorder = startReplayRecording(options.sdkSelector, {
      projectKey: options.projectKey,
      sessionId,
      resumed,
      recordPage: isCapturePageAllowed(policy),
    });
  }

  // The replay must not carry a page the policy leaves out. Once cut off it is not resumed, even back on an allowed page.
  function cutOffReplayOnDisallowedPage(): void {
    if (!replayRecorder || isCapturePageAllowed(policy)) return;
    replayRecorder.cutOff();
  }

  function discardReplay(): void {
    replayRecorder?.discard();
    replayRecorder = null;
  }

  function handleFlowComplete(flow: FlowAttachment): void {
    if (isDestroyed) return;
    finishedReplay = stoppedReplay ?? replayRecorder?.stop() ?? null;
    stoppedReplay = null;
    replayRecorder = null;
    attachments.flow = flow;
    emit();
    showWidget();
  }

  flowRecorder = createFlowRecorder({
    projectKey: options.projectKey,
    isPathAllowed: (path) => !policy || policy.allowedPaths.includes(path),
    isTargetAllowed: (id) => isGenericTargetLabel(id) || (policy?.targets.some((target) => target.id === id) ?? false),
    isPageAllowed: () => isCapturePageAllowed(policy),
    findTarget: (eventTarget) => {
      const found = findCaptureTarget(eventTarget, policy)?.target;
      return found ? { ...found, feedbackId: findFlowTargetLabel(eventTarget, policy) } : null;
    },
    onComplete: handleFlowComplete,
    onStateChange: handleFlowState,
  });

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
      return [{ number: index + 1, key: commentKeys[index], label, comment, offset: commentPoints[index], element: commentElements[index] }];
    });
  }

  function getEditMoveSources(): EditMoveSource[] {
    return attachments.edits.flatMap(({ target, originalRect, proposedRect }, index) => {
      if (target.pagePath !== undefined && target.pagePath !== window.location.pathname) {
        return [];
      }
      const label = target.feedbackId ?? target.tagName.toLowerCase();
      return [{ number: index + 1, key: editKeys[index], label, originalRect, proposedRect, element: editElements[index] }];
    });
  }

  /** Hands over the replay of the last completed Flow once; later calls return null. */
  function takeFlowReplay(): Promise<ReplayRecording | null> {
    const replay = finishedReplay;
    finishedReplay = null;
    return replay ?? Promise.resolve(null);
  }

  return {
    takeFlowReplay,
    getCommentPinSources,
    getEditMoveSources,
    handleCommand: unlessDestroyed(handleCommand),
    sync: emit,
    setPanelVisible: unlessDestroyed((visible: boolean) => {
      isPanelVisible = visible;
      renderStatus();
    }),
    pageChanged: unlessDestroyed(() => {
      cutOffReplayOnDisallowedPage();
      cancelTransient();
      flowRecorder?.recordNavigation();
      emit();
    }),
    cancelTransient: unlessDestroyed(cancelTransient),
    reset: unlessDestroyed(resetCapture),
    destroy: unlessDestroyed(destroyCapture),
  };
}
