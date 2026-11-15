'use client';

import { useState, type ComponentType } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { VStack } from '@astryxdesign/core/VStack';

import { CameraIcon, FlowIcon, MoveIcon, PinIcon, type IconProps } from '@/components/widget/WidgetIcons';
import { AttachmentCard, WidgetBanner, WidgetBody, WidgetFooter, WidgetHeader } from '@/components/widget/WidgetLayout';
import {
  MAX_COMMENT_LENGTH,
  MAX_COMMENTS,
  MAX_EDITS,
  MAX_REPLAY_DURATION_MS,
  MAX_SCREEN_SNAPSHOTS_PER_FEEDBACK,
} from '@/lib/feedback-limits';
import { describeTarget } from '@/lib/target-labels';
import type { EditAttachment, ElementTarget, FlowAttachment, FlowEventType } from '@/types/feedback';
import type { AttachmentKind, CaptureMode, CaptureState } from '@/types/sdk-message';

type Attachments = CaptureState['attachments'];

const MAX_FLOW_LABELS = 5;
const MAX_FLOWS = 1;
const MAX_REPLAY_MINUTES = Math.round(MAX_REPLAY_DURATION_MS / 60000);
const COMMENT_DRAFT_LABEL = '이 요소에 대한 의견';
const RECORDING_LABEL = '기록 중';

const MODE_LABELS: Record<CaptureMode, string> = {
  comment: '요소 코멘트',
  edit: '위치 편집',
  flow: '흐름 기록',
};

const MODE_ICONS: Record<CaptureMode, ComponentType<IconProps>> = {
  comment: PinIcon,
  edit: MoveIcon,
  flow: FlowIcon,
};

const FLOW_EVENT_LABELS: Record<FlowEventType, string> = {
  click: '클릭',
  navigation: '화면 이동',
  input: '입력',
};

const MODES: CaptureMode[] = ['comment', 'edit', 'flow'];

export function getTargetLabel(target: Pick<ElementTarget, 'feedbackId' | 'tagName'>): string {
  return describeTarget(target);
}

function getEditSummary(edit: EditAttachment): string {
  const deltaX = Math.round(edit.proposedRect.x - edit.originalRect.x);
  const deltaY = Math.round(edit.proposedRect.y - edit.originalRect.y);
  return `${getTargetLabel(edit.target)} (가로 ${deltaX}px, 세로 ${deltaY}px 이동)`;
}

function getFlowSequence(flow: FlowAttachment): string {
  const labels = flow.events.slice(0, MAX_FLOW_LABELS).map((event) => FLOW_EVENT_LABELS[event.type]);
  if (flow.events.length > MAX_FLOW_LABELS) {
    return `${labels.join(' → ')} → …`;
  }
  return labels.join(' → ');
}

export function countAttachments(attachments: Attachments): number {
  return attachments.comments.length + attachments.edits.length + (attachments.flow ? 1 : 0);
}

/** How many screens the draft holds, and whether one more is being saved right now. */
interface ScreenSlots {
  screenCount: number;
  isSavingScreen: boolean;
}

export function findStartBlocker(mode: CaptureMode, attachments: Attachments, { screenCount, isSavingScreen }: ScreenSlots): string | null {
  if (mode === 'comment' && attachments.comments.length >= MAX_COMMENTS) {
    return `코멘트는 최대 ${MAX_COMMENTS}개까지 첨부할 수 있어요.`;
  }
  if (mode === 'edit' && attachments.edits.length >= MAX_EDITS) {
    return `위치 편집은 최대 ${MAX_EDITS}개까지 첨부할 수 있어요.`;
  }
  if (mode === 'flow' && attachments.flow !== null) {
    return '흐름 기록은 1개만 첨부할 수 있어요. 기존 기록을 지운 뒤 다시 시작해 주세요.';
  }
  // A finished Flow is attached as a replay screen. Without a free slot it could not be attached, and
  // freeing one afterwards would not bring the replay back.
  if (mode === 'flow' && screenCount >= MAX_SCREEN_SNAPSHOTS_PER_FEEDBACK) {
    return `저장한 화면이 ${MAX_SCREEN_SNAPSHOTS_PER_FEEDBACK}개라 흐름 재생을 붙일 자리가 없어요. 화면을 하나 지운 뒤 시작해 주세요.`;
  }
  if (mode === 'flow' && isSavingScreen) {
    return '화면을 저장하는 중이에요. 끝난 뒤 흐름 기록을 시작해 주세요.';
  }
  return null;
}

function getModeUsage(mode: CaptureMode, attachments: Attachments): string {
  if (mode === 'comment') {
    return `${attachments.comments.length}/${MAX_COMMENTS}`;
  }
  if (mode === 'edit') {
    return `${attachments.edits.length}/${MAX_EDITS}`;
  }
  return `${attachments.flow ? 1 : 0}/${MAX_FLOWS}`;
}

interface ToolButtonProps {
  icon: ComponentType<IconProps>;
  label: string;
  usage: string | null;
  /** Why the tool cannot start, or what it does when the name alone does not say. */
  tooltip: string | null;
  disabled: boolean;
  onClick: () => void;
}

function ToolButton({ icon, label, usage, tooltip, disabled, onClick }: ToolButtonProps) {
  return (
    <Button
      label={label}
      icon={<Icon icon={icon} />}
      endContent={usage ? <Badge label={usage} /> : undefined}
      tooltip={tooltip ?? undefined}
      size="lg"
      width="100%"
      isDisabled={disabled}
      onClick={onClick}
    />
  );
}

interface CaptureToolBarProps {
  attachments: Attachments | null;
  enabled: boolean;
  disabled: boolean;
  screenCount: number;
  isSavingScreen: boolean;
  canCaptureScreen: boolean;
  /** What the screen tool does, shown as its tooltip. */
  screenToolTitle: string;
  onStart: (mode: CaptureMode) => void;
  onCaptureScreen: () => void;
}

export function CaptureToolBar({
  attachments,
  enabled,
  disabled,
  screenCount,
  isSavingScreen,
  canCaptureScreen,
  screenToolTitle,
  onStart,
  onCaptureScreen,
}: CaptureToolBarProps) {
  const showUsage = screenCount > 0 || (attachments !== null && countAttachments(attachments) > 0);

  return (
    <section aria-label="화면으로 보여주기">
      <VStack gap={1.5}>
        <Text as="p" type="supporting">
          화면으로 보여주기 (선택)
        </Text>
        <div className="grid grid-cols-2 gap-2">
          {MODES.map((mode) => {
            const blocker = attachments ? findStartBlocker(mode, attachments, { screenCount, isSavingScreen }) : null;
            return (
              <ToolButton
                key={mode}
                icon={MODE_ICONS[mode]}
                label={MODE_LABELS[mode]}
                usage={showUsage && attachments ? getModeUsage(mode, attachments) : null}
                tooltip={blocker}
                disabled={disabled || !enabled || attachments === null || blocker !== null}
                onClick={() => onStart(mode)}
              />
            );
          })}
          <ToolButton
            icon={CameraIcon}
            label="화면 저장"
            usage={showUsage ? `${screenCount}/${MAX_SCREEN_SNAPSHOTS_PER_FEEDBACK}` : null}
            tooltip={screenToolTitle}
            disabled={disabled || !canCaptureScreen}
            onClick={onCaptureScreen}
          />
        </div>
      </VStack>
    </section>
  );
}

interface CaptureAttachmentCardsProps {
  attachments: Attachments;
  disabled: boolean;
  onRemove: (kind: AttachmentKind, index: number) => void;
}

/** List items for the comments, edits and Flow, in that order. */
export function CaptureAttachmentCards({ attachments, disabled, onRemove }: CaptureAttachmentCardsProps) {
  return (
    <>
      {attachments.comments.map((comment, index) => (
        <AttachmentCard
          key={`comment-${index}`}
          kind="comment"
          icon={PinIcon}
          title={`코멘트 ${index + 1}`}
          description={`${getTargetLabel(comment.target)} · ${comment.comment}`}
          removeLabel={`코멘트 ${index + 1} 삭제`}
          disabled={disabled}
          onRemove={() => onRemove('comments', index)}
        />
      ))}
      {attachments.edits.map((edit, index) => (
        <AttachmentCard
          key={`edit-${index}`}
          kind="edit"
          icon={MoveIcon}
          title={`위치 편집 ${index + 1}`}
          description={getEditSummary(edit)}
          removeLabel={`위치 편집 ${index + 1} 삭제`}
          disabled={disabled}
          onRemove={() => onRemove('edits', index)}
        />
      ))}
      {attachments.flow ? (
        <AttachmentCard
          kind="flow"
          icon={FlowIcon}
          title={`흐름 기록 · 이벤트 ${attachments.flow.events.length}개`}
          description={getFlowSequence(attachments.flow) || '기록된 동작이 없어요'}
          removeLabel="흐름 기록과 재생 화면 삭제"
          disabled={disabled}
          onRemove={() => onRemove('flow', 0)}
        />
      ) : null}
    </>
  );
}

interface CaptureModeViewProps extends Pick<CaptureState, 'attachments' | 'selection' | 'flowEventCount'> {
  activeMode: CaptureMode;
  disabled: boolean;
  onClose: () => void;
  onCancel: () => void;
  onStopFlow: () => void;
  onAddComment: (comment: string) => void;
}

/** While a mode runs, the widget shows only the one thing to do and a way out. */
export function CaptureModeView({
  activeMode,
  attachments,
  selection,
  flowEventCount,
  disabled,
  onClose,
  onCancel,
  onStopFlow,
  onAddComment,
}: CaptureModeViewProps) {
  const [commentDraft, setCommentDraft] = useState('');
  const selectionKey = selection ? `${selection.feedbackId ?? selection.tagName}:${selection.selector}` : null;
  const [draftSelection, setDraftSelection] = useState(selectionKey);

  // A draft belongs to the element it was written for: drop it when the selection changes.
  if (draftSelection !== selectionKey) {
    setDraftSelection(selectionKey);
    setCommentDraft('');
  }

  const trimmedDraft = commentDraft.trim();
  const canAttachComment = !disabled && attachments.comments.length < MAX_COMMENTS && trimmedDraft.length > 0;

  function handleAttachComment() {
    if (!canAttachComment) {
      return;
    }
    onAddComment(trimmedDraft);
    setCommentDraft('');
  }

  function handleCancel() {
    setCommentDraft('');
    onCancel();
  }

  if (activeMode === 'comment' && selection) {
    return (
      <>
        <WidgetHeader
          title="요소 코멘트"
          subtitle={`코멘트 ${attachments.comments.length + 1}/${MAX_COMMENTS}`}
          onBack={handleCancel}
          onClose={onClose}
        />
        <WidgetBody>
          <WidgetBanner tone="info" title="요소를 골랐어요" icon={<Icon icon="check" />}>
            <span className="block">
              선택한 요소 <strong>{getTargetLabel(selection)}</strong>
            </span>
            <span className="block">페이지 위 입력창이나 아래 칸에 의견을 적어 주세요.</span>
          </WidgetBanner>
        </WidgetBody>
        <WidgetFooter>
          <TextArea
            label={COMMENT_DRAFT_LABEL}
            aria-label={COMMENT_DRAFT_LABEL}
            hasAutoFocus
            rows={3}
            value={commentDraft}
            maxLength={MAX_COMMENT_LENGTH}
            htmlMaxLength={MAX_COMMENT_LENGTH}
            isDisabled={disabled}
            onChange={setCommentDraft}
          />
          <HStack gap={2}>
            <Button label="취소" size="lg" width="100%" onClick={handleCancel} />
            <Button label="코멘트 첨부" variant="primary" size="lg" width="100%" isDisabled={!canAttachComment} onClick={handleAttachComment} />
          </HStack>
        </WidgetFooter>
      </>
    );
  }

  if (activeMode === 'comment') {
    return (
      <>
        <WidgetHeader title="요소 코멘트" subtitle="Esc 키로도 취소할 수 있어요" onClose={onClose} />
        <WidgetBody>
          <WidgetBanner tone="info" title="페이지에서 요소를 클릭하세요" icon={<Icon icon={PinIcon} />}>
            마우스를 올리면 파란 테두리가 보여요. 클릭해도 원래 버튼은 실행되지 않아요. 고른 자리에서 바로 의견을 적을 수 있어요.
          </WidgetBanner>
        </WidgetBody>
        <WidgetFooter>
          <Button label="요소 코멘트 취소" size="lg" width="100%" onClick={handleCancel} data-autofocus="" />
        </WidgetFooter>
      </>
    );
  }

  if (activeMode === 'edit') {
    return (
      <>
        <WidgetHeader title="위치 편집" subtitle={`위치 편집 ${attachments.edits.length + 1}/${MAX_EDITS} · Esc 키로도 취소할 수 있어요`} onClose={onClose} />
        <WidgetBody>
          {selection ? (
            <WidgetBanner tone="info" title="요소를 골랐어요" icon={<Icon icon="check" />}>
              <span className="block">
                옮기는 요소 <strong>{getTargetLabel(selection)}</strong>
              </span>
              <span className="block">
                페이지에서 끌어 옮긴 뒤 <strong>변경 첨부</strong>를 눌러 주세요. 방향키로도 옮길 수 있어요.
              </span>
            </WidgetBanner>
          ) : (
            <WidgetBanner tone="info" title="요소를 원하는 곳으로 끌어 놓으세요" icon={<Icon icon={MoveIcon} />}>
              먼저 페이지에서 옮길 요소를 클릭하세요. 다 옮겼으면 페이지 위의 <strong>변경 첨부</strong> 버튼을 눌러 주세요. 미리보기일 뿐이라 실제 화면과 데이터는 바뀌지 않아요.
            </WidgetBanner>
          )}
        </WidgetBody>
        <WidgetFooter>
          <Button label="위치 편집 취소" size="lg" width="100%" onClick={handleCancel} data-autofocus="" />
        </WidgetFooter>
      </>
    );
  }

  return (
    <>
      <WidgetHeader title="흐름 기록" subtitle={`평소처럼 페이지를 사용하세요 · 최대 ${MAX_REPLAY_MINUTES}분`} onClose={onClose} />
      <WidgetBody>
        <Card padding={3}>
          <VStack gap={2}>
            <HStack gap={2} align="center">
              <StatusDot variant="error" label={RECORDING_LABEL} isPulsing />
              <Text type="label">{RECORDING_LABEL}</Text>
            </HStack>
            <Text as="p">
              클릭, 화면 이동과 화면 변화를 기록해 담당자가 그대로 재생해 볼 수 있어요. <strong>입력한 값은 가려서 저장해요.</strong>
            </Text>
            <Text as="p" color="secondary">
              지금까지 {flowEventCount}개 동작을 기록했어요.
            </Text>
          </VStack>
        </Card>
        <WidgetBanner tone="warning">
          다른 페이지로 이동하면 <strong>작성 중이던 글이 지워질 수 있어요.</strong> 기록을 마친 뒤 글을 써 주세요.
        </WidgetBanner>
      </WidgetBody>
      <WidgetFooter>
        <HStack gap={2}>
          <Button label="기록 취소" size="lg" width="100%" onClick={handleCancel} />
          <Button label="기록 종료 및 첨부" variant="primary" size="lg" width="100%" isDisabled={disabled} onClick={onStopFlow} data-autofocus="" />
        </HStack>
      </WidgetFooter>
    </>
  );
}
