import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCaptureController } from '@/sdk/capture-controller';
import { createCaptureCommand } from '@/lib/capture-protocol';
import type { CapturePolicy } from '@/lib/capture-policy';
import type { ElementSelectionOptions } from '@/sdk/element-selection';
import type { ElementDragOptions } from '@/sdk/element-drag';
import type { FlowRecorderOptions } from '@/sdk/flow-recorder';
import type { CaptureState } from '@/types/sdk-message';
import type { FlowAttachment } from '@/types/feedback';

const engines = vi.hoisted(() => ({
  select: vi.fn(), drag: vi.fn(), flow: vi.fn(), render: vi.fn(), removeStatus: vi.fn(),
  cancelSelection: vi.fn(), cancelDrag: vi.fn(), destroyFlow: vi.fn(),
}));
vi.mock('@/sdk/element-selection', () => ({ startElementSelection: engines.select }));
vi.mock('@/sdk/element-drag', () => ({ startElementDrag: engines.drag }));
vi.mock('@/sdk/flow-recorder', () => ({ createFlowRecorder: engines.flow }));
vi.mock('@/sdk/capture-status', () => ({
  createCaptureStatus: () => ({ render: engines.render, destroy: engines.removeStatus }),
}));

const POLICY: CapturePolicy = { allowedPaths: ['/'], targets: [{ id: 'save', selector: 'button' }] };
const FLOW: FlowAttachment = { startedAt: '2026-11-12T12:00:00Z', endedAt: '2026-11-12T12:01:00Z', events: [] };
let selectionOptions: ElementSelectionOptions | undefined;
let dragOptions: ElementDragOptions | undefined;
let restoredFlow = false;

beforeEach(() => {
  vi.clearAllMocks();
  selectionOptions = undefined;
  dragOptions = undefined;
  restoredFlow = false;
  vi.stubGlobal('window', { location: { pathname: '/' } });
  vi.stubGlobal('document', { createElement: () => ({ attachShadow: () => ({}) }) });
  engines.select.mockImplementation((options: ElementSelectionOptions) => {
    selectionOptions = options;
    return { cancel: engines.cancelSelection };
  });
  engines.drag.mockImplementation((_selection, options: ElementDragOptions) => {
    dragOptions = options;
    return { cancel: () => { engines.cancelDrag(); options.onCancel(); } };
  });
  engines.flow.mockImplementation((options: FlowRecorderOptions) => {
    const state = (recording: boolean) => options.onStateChange({
      recording, eventCount: 0, storageAvailable: true, errorMessage: null,
    });
    state(restoredFlow);
    return {
      start: () => state(true),
      stop: () => { state(false); options.onComplete(FLOW); },
      cancel: () => state(false),
      recordNavigation: vi.fn(),
      destroy: engines.destroyFlow,
    };
  });
});
afterEach(() => vi.unstubAllGlobals());

function createHarness(policy: CapturePolicy | null = POLICY) {
  const states: CaptureState[] = [];
  const show = vi.fn();
  const controller = createCaptureController({
    projectKey: 'demo', policy, root: document.createElement('div').attachShadow({ mode: 'closed' }),
    onUpdate: (state) => states.push(state), onShowWidget: show, onHideWidget: vi.fn(),
  });
  controller.sync();
  return { controller, states, show };
}

function selectTarget() {
  if (!selectionOptions) throw new Error('Selection did not start.');
  selectionOptions.onSelect({
    element: document.createElement('button'),
    target: { selector: 'button', feedbackId: 'save', tagName: 'button', rect: { x: 1, y: 2, width: 80, height: 30 } },
  });
}

it('restores Flow synchronously without accessing an unassigned recorder', () => {
  restoredFlow = true;
  const { controller, states } = createHarness();
  expect(states.at(-1)?.activeMode).toBe('flow');
  controller.destroy();
});

it('attaches a selected comment and preserves it across mode cancellation', () => {
  const { controller, states } = createHarness();
  controller.handleCommand(createCaptureCommand({ type: 'capture:start', payload: { mode: 'comment' } }));
  selectTarget();
  controller.handleCommand(createCaptureCommand({ type: 'comment:add', payload: { comment: '  Make it visible  ' } }));
  controller.handleCommand(createCaptureCommand({ type: 'capture:start', payload: { mode: 'edit' } }));
  controller.cancelTransient();

  expect(states.at(-1)?.attachments.comments[0].comment).toBe('Make it visible');
  expect(states.at(-1)?.activeMode).toBeNull();
  controller.destroy();
});

it('keeps the live element of each comment for pinning on saved screens', () => {
  const { controller } = createHarness();
  for (const comment of ['first', 'second']) {
    controller.handleCommand(createCaptureCommand({ type: 'capture:start', payload: { mode: 'comment' } }));
    selectTarget();
    controller.handleCommand(createCaptureCommand({ type: 'comment:add', payload: { comment } }));
  }
  controller.handleCommand(createCaptureCommand({ type: 'attachment:remove', payload: { kind: 'comments', index: 0 } }));

  const sources = controller.getCommentPinSources();
  expect(sources).toEqual([{ number: 1, key: 'comment-2', label: 'save', comment: 'second', element: expect.anything() }]);
  controller.reset();
  expect(controller.getCommentPinSources()).toEqual([]);
  controller.destroy();
});

it('keeps the dragged element of each edit for marking on saved screens', () => {
  const { controller } = createHarness();
  controller.handleCommand(createCaptureCommand({ type: 'capture:start', payload: { mode: 'edit' } }));
  selectTarget();
  const rect = { x: 1, y: 2, width: 80, height: 30 };
  dragOptions?.onComplete({
    target: { selector: 'button', feedbackId: 'save', tagName: 'button', rect },
    originalRect: rect, proposedRect: { ...rect, x: 41 }, viewportWidth: 1440, viewportHeight: 900, note: '',
  });

  expect(controller.getEditMoveSources()).toEqual([
    { number: 1, key: 'edit-1', label: 'save', originalRect: rect, proposedRect: { ...rect, x: 41 }, element: expect.anything() },
  ]);
  controller.handleCommand(createCaptureCommand({ type: 'attachment:remove', payload: { kind: 'edits', index: 0 } }));
  expect(controller.getEditMoveSources()).toEqual([]);
  controller.destroy();
});

it('pins only the comments written on the current page, keeping their numbers', () => {
  const { controller } = createHarness();
  for (const pagePath of ['/', '/orders']) {
    controller.handleCommand(createCaptureCommand({ type: 'capture:start', payload: { mode: 'comment' } }));
    selectionOptions?.onSelect({
      element: document.createElement('button'),
      target: { selector: 'button', pagePath, feedbackId: 'save', tagName: 'button', rect: { x: 1, y: 2, width: 80, height: 30 } },
    });
    controller.handleCommand(createCaptureCommand({ type: 'comment:add', payload: { comment: pagePath } }));
  }
  (window as { location: { pathname: string } }).location.pathname = '/orders';

  expect(controller.getCommentPinSources().map(({ number, comment }) => ({ number, comment }))).toEqual([{ number: 2, comment: '/orders' }]);
  controller.destroy();
});

it('does not reopen the panel when cancelling a drag programmatically', () => {
  const { controller, show } = createHarness();
  controller.handleCommand(createCaptureCommand({ type: 'capture:start', payload: { mode: 'edit' } }));
  selectTarget();
  expect(dragOptions).toBeDefined();

  controller.cancelTransient();

  expect(engines.cancelDrag).toHaveBeenCalledOnce();
  expect(show).not.toHaveBeenCalled();
  controller.destroy();
});

it('publishes Flow completion atomically without a submit-ready empty attachment state', async () => {
  const { controller, states } = createHarness();
  controller.handleCommand(createCaptureCommand({ type: 'capture:start', payload: { mode: 'flow' } }));
  const beforeStop = states.length;

  controller.handleCommand(createCaptureCommand({ type: 'flow:stop', payload: {} }));
  await Promise.resolve();

  expect(states.at(-1)?.attachments.flow).toEqual(FLOW);
  expect(states.slice(beforeStop).every((state) => state.activeMode === 'flow' || state.attachments.flow !== null)).toBe(true);
  controller.destroy();
});

it('rejects capture without a policy and ignores commands after destroy', () => {
  const { controller, states } = createHarness(null);
  controller.handleCommand(createCaptureCommand({ type: 'capture:start', payload: { mode: 'comment' } }));
  expect(states.at(-1)?.enabled).toBe(false);
  expect(engines.select).not.toHaveBeenCalled();
  controller.destroy();
  const count = states.length;
  controller.sync();
  controller.handleCommand(createCaptureCommand({ type: 'capture:start', payload: { mode: 'flow' } }));
  expect(states).toHaveLength(count);
});
