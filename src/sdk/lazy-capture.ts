// The capture controller as sdk.js holds it. The real one (src/sdk/capture-controller.ts) comes with the
// capture runtime, a file that is loaded only once it is needed. Until then nothing can be active or
// attached, so this answers with that state; from then on every call goes to the real controller.
import { maskText } from '@/sdk/automatic-masking';
import type { CaptureControllerOptions } from '@/sdk/capture-controller';
import { isCapturePageAllowed } from '@/sdk/capture-policy';
import { clearFlowSession, findSessionStorage, getFlowSessionKey } from '@/sdk/flow-session';
import type { PreviewPanel } from '@/sdk/preview-panel';
import type { CaptureRuntime } from '@/sdk/runtime-loader';
import type { CaptureCommand } from '@/types/sdk-message';

export interface LazyCaptureOptions extends CaptureControllerOptions {
  /**
   * Imports the runtime. It is told how many loads have failed, so that a retry can ask under a new
   * address. Rejects when the runtime cannot be loaded.
   */
  loadRuntime: (failedLoads: number) => Promise<CaptureRuntime>;
  widgetPanel: Element;
  appOrigin: string;
  onPreviewClose: (previewId: string) => void;
  /** The page title may be masked differently from here on: the static text index was loaded or has finished. */
  onTitleChange: () => void;
}

export type LazyCapture = ReturnType<typeof createLazyCapture>;

const RUNTIME_UNAVAILABLE_MESSAGE = '화면 첨부 도구를 불러오지 못했습니다. 다시 시도하거나 페이지를 새로고침하세요.';
// For a retry that failed as well. The file this sdk.js asks for is then most likely gone: the app was
// deployed again after the page loaded sdk.js, and only a reload brings the sdk.js that asks for the new file.
const RUNTIME_OUTDATED_MESSAGE = '피드백 도구가 업데이트된 것으로 보입니다. 페이지를 새로고침해야 화면을 첨부할 수 있습니다. 글로 쓴 피드백은 새로고침하지 않아도 지금 보낼 수 있습니다.';

export function createLazyCapture(options: LazyCaptureOptions) {
  const { policy, projectKey } = options;
  let runtime: CaptureRuntime | null = null;
  let controller: ReturnType<CaptureRuntime['createCaptureController']> | null = null;
  let previewPanel: PreviewPanel | null = null;
  let stopWatchingIndex: (() => void) | null = null;
  let isPanelVisible = false;
  let isDestroyed = false;
  let loading: Promise<CaptureRuntime> | null = null;
  let failedLoads = 0;

  // What the widget is told while there is no controller: capture can start and nothing is attached.
  function emitIdleState(errorMessage: string | null): void {
    if (isDestroyed) return;
    options.onUpdate({
      enabled: isCapturePageAllowed(policy), activeMode: null, selection: null, flowEventCount: 0,
      attachments: { comments: [], edits: [], flow: null }, commentKeys: [], editKeys: [], errorMessage,
    });
  }

  function attach(loaded: CaptureRuntime): void {
    if (controller || isDestroyed) return;
    loaded.configureAutomaticMasking(policy?.automaticMasking);
    stopWatchingIndex = loaded.onStaticIndexSettled(options.onTitleChange);
    controller = loaded.createCaptureController(options);
    previewPanel = loaded.createPreviewPanel({
      root: options.root, widgetPanel: options.widgetPanel, appOrigin: options.appOrigin, projectKey,
      onClose: options.onPreviewClose,
    });
    runtime = loaded;
    controller.setPanelVisible(isPanelVisible);
    controller.sync();
    options.onTitleChange();
  }

  // Every caller shares one load. A failed load is not kept, so the next call tries again.
  function load(): Promise<CaptureRuntime> {
    loading ??= options.loadRuntime(failedLoads).then((loaded) => {
      attach(loaded);
      return loaded;
    }, (error: unknown) => {
      loading = null;
      failedLoads += 1;
      throw error;
    });
    return loading;
  }

  // A failed load is left alone here: nothing was asked for yet, and a capture that needs the tools reports it.
  function warm(): void {
    void load().then((loaded) => {
      if (isPanelVisible && !isDestroyed) loaded.warmStaticTextIndex();
    }, () => undefined);
  }

  // The title is checked against the static text index, which comes with the runtime. Until then it is
  // masked whole, as it is while the index is still being built, unless the policy turns masking off.
  function maskTitle(title: string): string {
    if (runtime) return runtime.createAutomaticMasker().text(title);
    return policy?.automaticMasking?.enabled === false ? title : maskText(title);
  }

  function hasStoredFlow(): boolean {
    const storage = findSessionStorage();
    try {
      return storage !== null && storage.getItem(getFlowSessionKey(projectKey)) !== null;
    } catch (error) {
      // Storage the browser refuses to read is treated as absent: there is no Flow to go on with.
      if (!(error instanceof DOMException)) throw error;
      return false;
    }
  }

  // A document restored from the back/forward cache may find a Flow that was started on a later page. The
  // controller picks it up when there is one. Without one, the tools are loaded first.
  function handlePageShow(event: PageTransitionEvent): void {
    if (event.persisted && !controller && hasStoredFlow()) warm();
  }

  // The controller ends the Flow kept in session storage. Without a controller the same is done here, so
  // that one attached later finds no recording to go on with.
  function endStoredFlow(): void {
    const storage = findSessionStorage();
    if (storage) clearFlowSession(storage, getFlowSessionKey(projectKey));
  }

  // A new draft starts clean, as with the controller: a Flow kept from the last one is ended, and a load
  // failure shown for it is dropped.
  function resetWithoutController(): void {
    endStoredFlow();
    emitIdleState(null);
  }

  function destroy(): void {
    if (isDestroyed) return;
    isDestroyed = true;
    window.removeEventListener('pageshow', handlePageShow);
    stopWatchingIndex?.();
    if (controller) {
      controller.destroy();
    } else {
      endStoredFlow();
    }
    previewPanel?.destroy();
  }

  window.addEventListener('pageshow', handlePageShow);
  // A Flow that is being recorded goes on in this document, so its tools are loaded right away.
  if (hasStoredFlow()) warm();

  return {
    /** Resolves once the tools are loaded and attached. */
    load,
    /** Loads the tools ahead of the first capture, while the reporter reads the widget. */
    warm,
    /** Null until the tools are loaded. */
    get previewPanel(): PreviewPanel | null {
      return previewPanel;
    },
    /** Tells the widget that a capture could not start because the tools did not load. */
    reportUnavailable(): void {
      if (!controller) emitIdleState(failedLoads > 1 ? RUNTIME_OUTDATED_MESSAGE : RUNTIME_UNAVAILABLE_MESSAGE);
    },
    maskTitle,
    handleCommand(command: CaptureCommand): void {
      if (controller) controller.handleCommand(command);
      else if (command.type === 'draft:reset') resetWithoutController();
    },
    sync(): void {
      if (controller) controller.sync();
      else emitIdleState(null);
    },
    setPanelVisible(visible: boolean): void {
      isPanelVisible = visible;
      controller?.setPanelVisible(visible);
    },
    // Whether this page may be captured is part of the state the widget shows.
    pageChanged(): void {
      if (controller) controller.pageChanged();
      else emitIdleState(null);
    },
    cancelTransient: () => controller?.cancelTransient(),
    reset(): void {
      if (controller) controller.reset();
      else resetWithoutController();
    },
    takeFlowReplay: () => controller?.takeFlowReplay() ?? Promise.resolve(null),
    getCommentPinSources: () => controller?.getCommentPinSources() ?? [],
    getEditMoveSources: () => controller?.getEditMoveSources() ?? [],
    destroy,
  };
}
