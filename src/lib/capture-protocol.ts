import { MAX_COMMENT_LENGTH, MAX_COMMENTS, MAX_EDITS, MAX_FLOW_EVENTS } from '@/lib/feedback-limits';
import {
  MESSAGE_SOURCE, PROTOCOL_VERSION,
  type CaptureCommand, type CaptureMode, type CaptureState, type CaptureUpdateMessage,
} from '@/types/sdk-message';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function isText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum;
}
function isRect(value: unknown): boolean {
  return isRecord(value) && isNumber(value.x) && isNumber(value.y) &&
    isNumber(value.width) && value.width >= 0 && isNumber(value.height) && value.height >= 0;
}
function isTarget(value: unknown): boolean {
  return isRecord(value) && isText(value.selector, 500) && value.selector.length > 0 &&
    (value.pagePath === undefined || (isText(value.pagePath, 2048) &&
      value.pagePath.startsWith('/') && !/[?#]/.test(value.pagePath))) &&
    (value.feedbackId === null || isText(value.feedbackId, 200)) &&
    isText(value.tagName, 200) && isRect(value.rect);
}
function isFlow(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value) || !isText(value.startedAt, 40) || !isText(value.endedAt, 40) ||
    !Number.isFinite(Date.parse(value.startedAt)) || !Number.isFinite(Date.parse(value.endedAt)) ||
    !Array.isArray(value.events) || value.events.length > MAX_FLOW_EVENTS) return false;
  if (value.truncated !== undefined && typeof value.truncated !== 'boolean') return false;
  if (value.interrupted !== undefined && typeof value.interrupted !== 'boolean') return false;
  return value.events.every((event: unknown) => isRecord(event) &&
    typeof event.type === 'string' && ['click', 'navigation', 'input'].includes(event.type) &&
    isNumber(event.offsetMs) && Number.isInteger(event.offsetMs) && event.offsetMs >= 0 &&
    isText(event.path, 2048) && event.path.startsWith('/') && !/[?#]/.test(event.path) &&
    (event.targetLabel === null || isText(event.targetLabel, 200)) &&
    (event.navigationType === undefined ||
      (typeof event.navigationType === 'string' && ['spa', 'document', 'reload'].includes(event.navigationType))));
}
export function isCaptureMode(value: unknown): value is CaptureMode {
  return value === 'comment' || value === 'edit' || value === 'flow';
}
export function isCaptureState(value: unknown): value is CaptureState {
  if (!isRecord(value) || typeof value.enabled !== 'boolean' ||
    !(value.activeMode === null || isCaptureMode(value.activeMode)) ||
    !(value.selection === null || isTarget(value.selection)) ||
    !(value.errorMessage === null || isText(value.errorMessage, 1000)) ||
    !isNumber(value.flowEventCount) || !Number.isInteger(value.flowEventCount) ||
    value.flowEventCount < 0 || value.flowEventCount > MAX_FLOW_EVENTS) return false;
  const attachments = value.attachments;
  if (!isRecord(attachments) || !Array.isArray(attachments.comments) || !Array.isArray(attachments.edits) ||
    attachments.comments.length > MAX_COMMENTS || attachments.edits.length > MAX_EDITS) return false;
  return attachments.comments.every((comment: unknown) => isRecord(comment) &&
      isTarget(comment.target) && isText(comment.comment, MAX_COMMENT_LENGTH)) &&
    attachments.edits.every((edit: unknown) => isRecord(edit) && isTarget(edit.target) &&
      isRect(edit.originalRect) && isRect(edit.proposedRect) &&
      isNumber(edit.viewportWidth) && edit.viewportWidth >= 0 &&
      isNumber(edit.viewportHeight) && edit.viewportHeight >= 0 && isText(edit.note, MAX_COMMENT_LENGTH)) &&
    isFlow(attachments.flow);
}

type WithoutEnvelope<T> = T extends CaptureCommand ? Omit<T, 'source' | 'version'> : never;

export function createCaptureCommand(command: WithoutEnvelope<CaptureCommand>): CaptureCommand {
  return { source: MESSAGE_SOURCE, version: PROTOCOL_VERSION, ...command };
}

export function createCaptureUpdate(payload: CaptureState): CaptureUpdateMessage {
  return { source: MESSAGE_SOURCE, version: PROTOCOL_VERSION, type: 'capture:update', payload };
}

function hasEnvelope(value: unknown): value is Record<string, unknown> & { payload: Record<string, unknown> } {
  return isRecord(value) && value.source === MESSAGE_SOURCE && value.version === PROTOCOL_VERSION && isRecord(value.payload);
}

export function isCaptureUpdate(value: unknown): value is CaptureUpdateMessage {
  return hasEnvelope(value) && value.type === 'capture:update' && isCaptureState(value.payload);
}

export function isCaptureCommand(value: unknown): value is CaptureCommand {
  if (!hasEnvelope(value)) return false;
  const payload = value.payload;
  switch (value.type) {
    case 'capture:cancel':
    case 'flow:stop':
    case 'draft:reset':
      return true;
    case 'capture:start':
      return isCaptureMode(payload.mode);
    case 'comment:add':
      return isText(payload.comment, MAX_COMMENT_LENGTH) && payload.comment.trim().length > 0;
    case 'attachment:remove':
      return typeof payload.kind === 'string' && ['comments', 'edits', 'flow'].includes(payload.kind) &&
        isNumber(payload.index) && Number.isInteger(payload.index) && payload.index >= 0 && payload.index < MAX_COMMENTS;
    default:
      return false;
  }
}
