'use client';

import type { ReactNode } from 'react';
import { Card } from '@astryxdesign/core/Card';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { List, ListItem } from '@astryxdesign/core/List';
import { Slider } from '@astryxdesign/core/Slider';
import { Text } from '@astryxdesign/core/Text';
import { ToggleButton } from '@astryxdesign/core/ToggleButton';
import { VStack } from '@astryxdesign/core/VStack';

import {
  CommentPinOverlay,
  EditMoveOverlay,
  type CommentPinListProps,
  type CommentPinOverlayProps,
  type CommentPinOverlaySkin,
  type EditMoveListProps,
  type EditMoveOverlayProps,
  type EditMoveOverlaySkin,
} from '@/components/admin/ScreenMarkOverlay';
import {
  formatPlaybackTime,
  REPLAY_STEP_LABELS,
  type ReplayControlsProps,
  type ScreenReplayParts,
  type ZoomBarProps,
} from '@/components/admin/ScreenSnapshotViewer';
import { PauseIcon, PlayIcon, RestartIcon } from '@/components/widget/WidgetIcons';
import { WidgetBanner } from '@/components/widget/WidgetLayout';
import { describeMove, formatEditChange } from '@/lib/edit-comparison-geometry';
import { findAdjacentStep, getCurrentStepIndex } from '@/lib/screen-preview';
import { describeTarget } from '@/lib/target-labels';
import type { ScreenEditMove } from '@/types/screen-snapshot';

const PLAY_LABEL = '재생';
const PAUSE_LABEL = '일시정지';
const RESTART_LABEL = '처음부터';
const PREVIOUS_STEP_LABEL = '이전 단계';
const NEXT_STEP_LABEL = '다음 단계';
const FIT_LABEL = '화면에 맞춤';
const ACTUAL_SIZE_LABEL = '실제 크기';
const PROPOSED_LABEL = '제안 위치로 보기';
// An arrow key moves the position by a hundredth of the replay, and never by less than this.
const MIN_SEEK_STEP_MS = 100;

// The marks drawn over a saved screen look like the pins and outlines the SDK draws on the live page.
// The class names are defined in src/app/widget/widget.css.
const PIN_SKIN: CommentPinOverlaySkin = {
  target: 'widget-mark-target',
  selectedTarget: 'widget-mark-target widget-mark-target-selected',
  badge: 'widget-pin',
  bubble: 'widget-pin-note',
  label: 'widget-pin-note-label',
  comment: 'widget-pin-note-comment',
};

const MOVE_SKIN: EditMoveOverlaySkin = {
  original: 'widget-move-outline widget-move-original',
  vacatedOriginal: 'widget-move-outline widget-move-vacated',
  proposed: 'widget-move-outline widget-move-proposed',
  shownProposed: 'widget-move-outline widget-move-proposed widget-move-shown',
  label: 'widget-move-label',
};

// A mark names its element by a configured id or by its tag. The widget shows a tag by its everyday name.
function describeMarkedElement(label: string): string {
  return describeTarget({ feedbackId: null, tagName: label });
}

function describeEditMove(move: ScreenEditMove): string {
  const change = formatEditChange(describeMove(move.originalRect, move.proposedRect, move.rotation));
  return `${describeMarkedElement(move.label)} · ${change}`;
}

function PreviewReplayControls({ isPlaying, currentMs, totalMs, steps, onPlay, onPause, onSeek, onStep }: ReplayControlsProps) {
  const stepIndex = getCurrentStepIndex(steps, currentMs);
  const previousStep = findAdjacentStep(steps, currentMs, 'previous');
  const nextStep = findAdjacentStep(steps, currentMs, 'next');
  const playLabel = isPlaying ? PAUSE_LABEL : PLAY_LABEL;
  return (
    <section aria-label="흐름 재생">
      <Card padding={2} variant="muted">
        <div className="widget-replay-controls">
          <HStack gap={1} align="center">
            <IconButton
              label={playLabel}
              tooltip={playLabel}
              icon={<Icon icon={isPlaying ? PauseIcon : PlayIcon} />}
              variant="primary"
              size="lg"
              onClick={isPlaying ? onPause : onPlay}
            />
            <IconButton
              label={RESTART_LABEL}
              tooltip={RESTART_LABEL}
              icon={<Icon icon={RestartIcon} />}
              variant="ghost"
              size="lg"
              onClick={() => onSeek(0)}
            />
          </HStack>
          <div className="widget-replay-pager">
            <IconButton
              label={PREVIOUS_STEP_LABEL}
              tooltip={PREVIOUS_STEP_LABEL}
              icon={<Icon icon="chevronLeft" />}
              variant="ghost"
              size="lg"
              isDisabled={!previousStep}
              onClick={() => previousStep && onStep(previousStep.atMs)}
            />
            <Text type="label" hasTabularNumbers className="widget-replay-step">
              단계 {stepIndex + 1}/{steps.length} · {REPLAY_STEP_LABELS[steps[stepIndex].kind]}
            </Text>
            <IconButton
              label={NEXT_STEP_LABEL}
              tooltip={NEXT_STEP_LABEL}
              icon={<Icon icon="chevronRight" />}
              variant="ghost"
              size="lg"
              isDisabled={!nextStep}
              onClick={() => nextStep && onStep(nextStep.atMs)}
            />
          </div>
          <div className="widget-replay-position">
            <Slider
              label="재생 위치"
              isLabelHidden
              width="100%"
              min={0}
              max={Math.max(totalMs, 1)}
              step={Math.max(MIN_SEEK_STEP_MS, Math.round(totalMs / 100))}
              value={Math.min(currentMs, totalMs)}
              formatValue={formatPlaybackTime}
              onChange={onSeek}
            />
            <Text type="supporting" hasTabularNumbers className="shrink-0">
              {formatPlaybackTime(currentMs)} / {formatPlaybackTime(totalMs)}
            </Text>
          </div>
        </div>
      </Card>
    </section>
  );
}

function PreviewTruncatedNotice() {
  return <WidgetBanner tone="warning">기록 한도나 저장할 수 없는 페이지 때문에 일부 구간은 재생에서 빠졌어요.</WidgetBanner>;
}

// Pressing the mode that is already on leaves it on.
function PreviewZoomBar({ zoomMode, scale, unloadedAssetCount, onZoomModeChange }: ZoomBarProps) {
  return (
    <VStack gap={2}>
      <HStack gap={2} align="center" wrap="wrap">
        <HStack gap={1} role="group" aria-label="화면 크기">
          <ToggleButton label={FIT_LABEL} size="lg" isPressed={zoomMode === 'fit'} onPressedChange={() => onZoomModeChange('fit')}>
            {FIT_LABEL}
          </ToggleButton>
          <ToggleButton
            label={ACTUAL_SIZE_LABEL}
            size="lg"
            isPressed={zoomMode === 'actual'}
            onPressedChange={() => onZoomModeChange('actual')}
          >
            {ACTUAL_SIZE_LABEL}
          </ToggleButton>
        </HStack>
        <Text type="supporting" hasTabularNumbers>
          {Math.round(scale * 100)}%
        </Text>
        <Text type="supporting" className="widget-wheel-hint">
          마우스 휠로 저장한 화면 안을 스크롤할 수 있어요
        </Text>
      </HStack>
      {unloadedAssetCount > 0 ? (
        <WidgetBanner tone="warning">저장한 글꼴·이미지 {unloadedAssetCount}개를 불러오지 못했어요.</WidgetBanner>
      ) : null}
    </VStack>
  );
}

function PreviewEditMoveOverlay(props: EditMoveOverlayProps) {
  return <EditMoveOverlay {...props} skin={MOVE_SKIN} />;
}

interface OpenCommentScopeProps extends Pick<CommentPinOverlayProps, 'selectedNumber' | 'onSelect'> {
  children: ReactNode;
}

// Escape pressed on a pin or on a comment's row closes the open comment first. The press only reaches the
// preview's own Escape when no comment is open.
function OpenCommentScope({ selectedNumber, onSelect, children }: OpenCommentScopeProps) {
  return (
    <div
      className="contents"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && selectedNumber !== null) {
          event.preventDefault();
          onSelect(null);
        }
      }}
    >
      {children}
    </div>
  );
}

function PreviewCommentPinOverlay({ boxes, selectedNumber, onSelect, ...overlay }: CommentPinOverlayProps) {
  const namedBoxes = boxes.map((box) => ({ ...box, pin: { ...box.pin, label: describeMarkedElement(box.pin.label) } }));
  return (
    <OpenCommentScope selectedNumber={selectedNumber} onSelect={onSelect}>
      <CommentPinOverlay {...overlay} boxes={namedBoxes} selectedNumber={selectedNumber} onSelect={onSelect} skin={PIN_SKIN} keepsBubbleInView />
    </OpenCommentScope>
  );
}

function PreviewEditMoveList({ moves, showsProposed, onToggle }: EditMoveListProps) {
  const title = `위치 편집 ${moves.length}개`;
  return (
    <section aria-label={title}>
      <VStack gap={1.5}>
        <HStack gap={2} align="center" justify="between" wrap="wrap">
          <Text as="p" type="label">
            {title}
          </Text>
          <ToggleButton label={PROPOSED_LABEL} size="lg" isPressed={showsProposed} onPressedChange={onToggle}>
            {PROPOSED_LABEL}
          </ToggleButton>
        </HStack>
        <Text as="p" type="supporting">
          점선은 원래 위치, 실선은 제안 위치예요. 좌표로 옮겨 본 제안이라 실제 화면의 배치 코드를 바꾼 것과는 달라요.
        </Text>
        <List>
          {moves.map((move) => (
            <ListItem
              key={move.number}
              startContent={<span className="widget-mark-number">{move.number}</span>}
              label={`위치 편집 ${move.number}`}
              description={describeEditMove(move)}
            />
          ))}
        </List>
      </VStack>
    </section>
  );
}

function PreviewCommentPinList({ pins, selectedNumber, onSelect }: CommentPinListProps) {
  const title = `코멘트 ${pins.length}개`;
  return (
    <OpenCommentScope selectedNumber={selectedNumber} onSelect={onSelect}>
      <section aria-label={title}>
        <VStack gap={1.5}>
          <Text as="p" type="label">
            {title}
          </Text>
          <List>
            {pins.map((pin) => (
              <ListItem
                key={pin.number}
                align="start"
                startContent={<span className="widget-mark-number">{pin.number}</span>}
                label={<span className="whitespace-pre-wrap">{pin.comment}</span>}
                description={describeMarkedElement(pin.label)}
                isSelected={pin.number === selectedNumber}
                onClick={() => onSelect(pin.number === selectedNumber ? null : pin.number)}
              />
            ))}
          </List>
        </VStack>
      </section>
    </OpenCommentScope>
  );
}

/** The saved-screen replay drawn with the widget's own controls and marks. */
export const PREVIEW_REPLAY_PARTS: ScreenReplayParts = {
  ReplayControls: PreviewReplayControls,
  TruncatedNotice: PreviewTruncatedNotice,
  ZoomBar: PreviewZoomBar,
  EditMoveOverlay: PreviewEditMoveOverlay,
  CommentPinOverlay: PreviewCommentPinOverlay,
  EditMoveList: PreviewEditMoveList,
  CommentPinList: PreviewCommentPinList,
};
