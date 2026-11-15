import { createHostToWidgetMessage, isWidgetToHostMessage } from '@/lib/sdk-protocol';
import { createCaptureUpdate, isCaptureCommand } from '@/lib/capture-protocol';
import { findCapturePolicy, type CapturePolicy } from '@/lib/capture-policy';
import { CapturePageNotAllowedError } from '@/sdk/capture-guard';
import { isCapturePageAllowed } from '@/sdk/capture-policy';
import { createCaptureController } from '@/sdk/capture-controller';
import { createPendingStartGate } from '@/sdk/pending-start';
import { trackHistory } from '@/sdk/history-tracking';
import { copyReporter, isFeedbackReporter } from '@/sdk/reporter';
import { getPageContext } from '@/sdk/page-context';
import { captureRecording, captureScreen } from '@/sdk/screen-capture';
import { configureAutomaticMasking, onStaticIndexSettled, prepareStaticTextIndex, warmStaticTextIndex } from '@/sdk/static-text-index';
import {
  HOST_ELEMENT_STYLE, LAUNCHER_CLOSE_ICON_CLASS_NAME, LAUNCHER_ICON_CLASS_NAME, LAUNCHER_LABEL_CLASS_NAME, PANEL_OPEN_CLASS_NAME,
  SDK_STYLES,
} from '@/sdk/styles';
import type { FeedbackSdkInitOptions } from '@/sdk/types';
import type { FeedbackReporter } from '@/types/feedback';
import type { CaptureUpdateMessage, HostToWidgetMessage } from '@/types/sdk-message';

const LOG_PREFIX = '[LatticeFeedback]';
const HOST_ELEMENT_TAG_NAME = 'lattice-feedback-root';
const IFRAME_TITLE = 'Feedback';
const LAUNCHER_LABEL = 'Feedback';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
// A speech bubble while the panel is closed, a chevron pointing down while it is open.
const LAUNCHER_OPEN_ICON_PATH = 'M6 4h12a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-6l-5 4v-4H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z';
const LAUNCHER_CLOSE_ICON_PATH = 'm6 9 6 6 6-6';
const MAX_CONCURRENT_SCREEN_CAPTURES = 3;

function createLauncherIcon(className: string, pathData: string): SVGSVGElement {
  const iconElement = document.createElementNS(SVG_NAMESPACE, 'svg');
  iconElement.setAttribute('class', className);
  iconElement.setAttribute('viewBox', '0 0 24 24');
  iconElement.setAttribute('aria-hidden', 'true');
  const pathElement = document.createElementNS(SVG_NAMESPACE, 'path');
  pathElement.setAttribute('d', pathData);
  iconElement.append(pathElement);
  return iconElement;
}

export class FeedbackSdk {
  private readonly appOrigin: string;
  private projectKey: string | null = null;
  private reporter: FeedbackReporter | null = null;
  private hostElement: HTMLElement | null = null;
  private launcherButton: HTMLButtonElement | null = null;
  private panelElement: HTMLDivElement | null = null;
  private iframeElement: HTMLIFrameElement | null = null;
  private isWidgetReady = false;
  private isPanelOpen = false;
  private isDestroyed = false;
  private stopHistoryTracking: (() => void) | null = null;
  private capturePolicy: CapturePolicy | null = null;
  private captureController: ReturnType<typeof createCaptureController> | null = null;
  private pendingResizeFrame: number | null = null;
  // Each save serializes the page as soon as it is asked, so a save asked during another keeps its own moment.
  private activeScreenCaptures = 0;
  // Starts waiting for the static text index; close, cancel, reset and submit make them stale.
  private readonly pendingStarts = createPendingStartGate();
  // The page title is classified against the index, so it is sent again once the index has finished.
  private stopWatchingIndex: (() => void) | null = null;

  constructor(appOrigin: string) {
    this.appOrigin = appOrigin;
  }

  init(options: FeedbackSdkInitOptions): void {
    if (this.isDestroyed) {
      console.warn(`${LOG_PREFIX} init() called after destroy(); ignoring.`);
      return;
    }
    if (this.projectKey !== null) {
      console.warn(`${LOG_PREFIX} init() was already called; ignoring.`);
      return;
    }
    const projectKey = options?.projectKey;
    if (typeof projectKey !== 'string' || projectKey.trim() === '') {
      console.warn(`${LOG_PREFIX} init() requires a non-empty projectKey.`);
      return;
    }
    this.projectKey = projectKey;
    this.capturePolicy = options.capturePolicy === undefined
      ? null
      : findCapturePolicy(options.capturePolicy) ?? { allowedPaths: [], targets: [] };
    configureAutomaticMasking(this.capturePolicy?.automaticMasking);
    this.stopWatchingIndex = onStaticIndexSettled(() => this.updatePageContext());
    window.addEventListener('message', this.handleMessage);
    this.stopHistoryTracking = trackHistory(this.handleNavigation);
    if (document.body) {
      this.mount();
      return;
    }
    document.addEventListener('DOMContentLoaded', this.handleDomContentLoaded);
  }

  setUser(reporter: FeedbackReporter | null): void {
    if (reporter !== null && !isFeedbackReporter(reporter)) {
      console.warn(`${LOG_PREFIX} setUser() expects { id: string, name: string, email?: string, organization?: { id: string, name?: string } } or null; ignoring.`);
      return;
    }
    this.reporter = reporter === null ? null : copyReporter(reporter);
    if (this.isWidgetReady) {
      this.postToWidget(createHostToWidgetMessage('reporter:update', { reporter: this.reporter }));
    }
  }

  open(): void {
    if (this.projectKey === null || this.isDestroyed) {
      console.warn(`${LOG_PREFIX} open() requires init() first.`);
      return;
    }
    if (!this.panelElement || !this.launcherButton) {
      return;
    }
    this.ensureIframe();
    this.panelElement.classList.add(PANEL_OPEN_CLASS_NAME);
    this.launcherButton.setAttribute('aria-expanded', 'true');
    this.isPanelOpen = true;
    this.postToWidget(createHostToWidgetMessage('visibility:update', { isOpen: true }));
    warmStaticTextIndex();
    // Keyboard focus follows the panel in, so the next Tab lands inside it instead of back on the page.
    this.iframeElement?.focus({ preventScroll: true });
    // The viewport may have changed since the iframe was created, so refresh on every open.
    this.updatePageContext();
    this.captureController?.setPanelVisible(true);
    window.addEventListener('resize', this.handleResize);
  }

  close(): void {
    this.pendingStarts.invalidate();
    this.captureController?.cancelTransient();
    this.hideForCapture();
  }

  private hideForCapture(): void {
    if (!this.panelElement || !this.launcherButton) {
      return;
    }
    this.panelElement.classList.remove(PANEL_OPEN_CLASS_NAME);
    this.launcherButton.setAttribute('aria-expanded', 'false');
    this.isPanelOpen = false;
    this.postToWidget(createHostToWidgetMessage('visibility:update', { isOpen: false }));
    this.stopResizeTracking();
    this.captureController?.setPanelVisible(false);
  }

  destroy(): void {
    this.pendingStarts.invalidate();
    this.stopWatchingIndex?.();
    this.stopWatchingIndex = null;
    window.removeEventListener('message', this.handleMessage);
    document.removeEventListener('DOMContentLoaded', this.handleDomContentLoaded);
    this.stopResizeTracking();
    this.launcherButton?.removeEventListener('click', this.handleLauncherClick);
    this.stopHistoryTracking?.();
    this.stopHistoryTracking = null;
    this.captureController?.destroy();
    this.captureController = null;
    this.hostElement?.remove();
    this.hostElement = null;
    this.launcherButton = null;
    this.panelElement = null;
    this.iframeElement = null;
    this.isWidgetReady = false;
    this.isPanelOpen = false;
    this.projectKey = null;
    this.isDestroyed = true;
  }

  private mount(): void {
    const projectKey = this.projectKey;
    if (projectKey === null) return;
    const hostElement = document.createElement(HOST_ELEMENT_TAG_NAME);
    hostElement.setAttribute('style', HOST_ELEMENT_STYLE);
    const shadowRoot = hostElement.attachShadow({ mode: 'closed' });

    const styleElement = document.createElement('style');
    styleElement.textContent = SDK_STYLES;

    const panelElement = document.createElement('div');
    panelElement.className = 'panel';

    const launcherButton = document.createElement('button');
    launcherButton.type = 'button';
    launcherButton.className = 'launcher';
    const launcherLabel = document.createElement('span');
    launcherLabel.className = LAUNCHER_LABEL_CLASS_NAME;
    launcherLabel.textContent = LAUNCHER_LABEL;
    launcherButton.append(
      createLauncherIcon(LAUNCHER_ICON_CLASS_NAME, LAUNCHER_OPEN_ICON_PATH),
      createLauncherIcon(`${LAUNCHER_ICON_CLASS_NAME} ${LAUNCHER_CLOSE_ICON_CLASS_NAME}`, LAUNCHER_CLOSE_ICON_PATH),
      launcherLabel,
    );
    launcherButton.setAttribute('aria-expanded', 'false');
    launcherButton.addEventListener('click', this.handleLauncherClick);

    shadowRoot.append(styleElement, panelElement, launcherButton);
    document.body.appendChild(hostElement);

    this.hostElement = hostElement;
    this.panelElement = panelElement;
    this.captureController = createCaptureController({
      projectKey, policy: this.capturePolicy, root: shadowRoot, sdkSelector: HOST_ELEMENT_TAG_NAME,
      onUpdate: (state) => {
        if (this.isWidgetReady) this.postToWidget(createCaptureUpdate(state));
      },
      onShowWidget: () => this.open(),
      onHideWidget: () => this.hideForCapture(),
    });
    this.launcherButton = launcherButton;
  }

  private ensureIframe(): void {
    if (this.iframeElement || !this.panelElement || this.projectKey === null) {
      return;
    }
    const iframeElement = document.createElement('iframe');
    iframeElement.title = IFRAME_TITLE;
    // Keep host query strings out of the Referer header sent to the app server.
    iframeElement.referrerPolicy = 'origin';
    const parameters = new URLSearchParams({ projectKey: this.projectKey, hostOrigin: window.location.origin });
    iframeElement.src = `${this.appOrigin}/widget?${parameters.toString()}`;
    this.panelElement.appendChild(iframeElement);
    this.iframeElement = iframeElement;
  }

  private postToWidget(message: HostToWidgetMessage | CaptureUpdateMessage): void {
    const targetWindow = this.iframeElement?.contentWindow;
    if (!targetWindow) {
      return;
    }
    targetWindow.postMessage(message, this.appOrigin);
  }

  private sendInit(): void {
    if (this.projectKey === null) {
      return;
    }
    this.postToWidget(
      createHostToWidgetMessage('init', {
        projectKey: this.projectKey,
        reporter: this.reporter,
        page: getPageContext(),
      }),
    );
    this.captureController?.sync();
    this.postToWidget(createHostToWidgetMessage('visibility:update', { isOpen: this.isPanelOpen }));
  }

  private stopResizeTracking(): void {
    window.removeEventListener('resize', this.handleResize);
    if (this.pendingResizeFrame !== null) {
      window.cancelAnimationFrame(this.pendingResizeFrame);
      this.pendingResizeFrame = null;
    }
  }

  // Coalesce resize bursts into at most one page:update per animation frame.
  private readonly handleResize = (): void => {
    if (this.pendingResizeFrame !== null) {
      return;
    }
    this.pendingResizeFrame = window.requestAnimationFrame(() => {
      this.pendingResizeFrame = null;
      this.updatePageContext();
    });
  };

  private readonly handleDomContentLoaded = (): void => {
    document.removeEventListener('DOMContentLoaded', this.handleDomContentLoaded);
    if (!this.isDestroyed && !this.hostElement) {
      this.mount();
    }
  };

  private readonly handleLauncherClick = (): void => {
    if (this.isPanelOpen) {
      this.close();
      return;
    }
    this.open();
  };

  private readonly handleNavigation = (): void => {
    if (this.isDestroyed) return;
    this.pendingStarts.pageChanged();
    this.captureController?.pageChanged();
    this.updatePageContext();
  };

  private updatePageContext(): void {
    if (this.isDestroyed || !this.isWidgetReady) {
      return;
    }
    this.postToWidget(createHostToWidgetMessage('page:update', { page: getPageContext() }));
  }

  // Saving is allowed on any page with the SDK unless the customer's policy restricts the paths.
  private async saveScreen(requestId: string): Promise<void> {
    if (this.activeScreenCaptures >= MAX_CONCURRENT_SCREEN_CAPTURES) {
      this.postToWidget(createHostToWidgetMessage('screen:capture-failed', { requestId, reason: 'capture_failed' }));
      return;
    }
    if (this.capturePolicy && !this.capturePolicy.allowedPaths.includes(window.location.pathname)) {
      this.postToWidget(createHostToWidgetMessage('screen:capture-failed', { requestId, reason: 'page_not_allowed' }));
      return;
    }
    this.activeScreenCaptures += 1;
    try {
      const capture = await captureScreen(HOST_ELEMENT_TAG_NAME, {
        comments: this.captureController?.getCommentPinSources() ?? [],
        edits: this.captureController?.getEditMoveSources() ?? [],
      }, () => isCapturePageAllowed(this.capturePolicy));
      this.updatePageContext();
      this.postToWidget(createHostToWidgetMessage('screen:captured', { ...capture, requestId }));
    } catch (error) {
      console.warn(`${LOG_PREFIX} Saving the screen failed.`, error);
      const reason = error instanceof CapturePageNotAllowedError ? 'page_not_allowed' : 'capture_failed';
      this.postToWidget(createHostToWidgetMessage('screen:capture-failed', { requestId, reason }));
    } finally {
      this.activeScreenCaptures -= 1;
    }
  }

  private async saveFlowReplay(requestId: string): Promise<void> {
    try {
      const replay = await this.captureController?.takeFlowReplay();
      if (!replay) {
        this.postToWidget(createHostToWidgetMessage('screen:capture-failed', { requestId, reason: 'capture_failed' }));
        return;
      }
      this.postToWidget(createHostToWidgetMessage('screen:captured', { ...(await captureRecording(replay, HOST_ELEMENT_TAG_NAME)), requestId }));
    } catch (error) {
      console.warn(`${LOG_PREFIX} Saving the Flow replay failed.`, error);
      this.postToWidget(createHostToWidgetMessage('screen:capture-failed', { requestId, reason: 'capture_failed' }));
    }
  }

  private readonly handleMessage = (event: MessageEvent): void => {
    if (event.origin !== this.appOrigin) {
      return;
    }
    if (!this.iframeElement || event.source !== this.iframeElement.contentWindow) {
      return;
    }
    const message: unknown = event.data;
    if (isCaptureCommand(message)) {
      if (message.type === 'capture:start') {
        const isCurrent = this.pendingStarts.begin(message.payload.mode !== 'flow');
        void prepareStaticTextIndex().then(() => {
          if (isCurrent() && !this.isDestroyed) this.captureController?.handleCommand(message);
        });
      } else {
        if (message.type === 'capture:cancel' || message.type === 'draft:reset') this.pendingStarts.invalidate();
        this.captureController?.handleCommand(message);
      }
      return;
    }
    if (!isWidgetToHostMessage(message)) {
      return;
    }
    switch (message.type) {
      case 'ready':
        this.isWidgetReady = true;
        this.sendInit();
        break;
      case 'close':
        this.close();
        break;
      case 'submitted':
        this.pendingStarts.invalidate();
        this.captureController?.reset();
        break;
      case 'screen:capture':
        void this.saveScreen(message.payload.requestId);
        break;
      case 'flow:capture':
        void this.saveFlowReplay(message.payload.requestId);
        break;
      default: {
        const unhandledMessage: never = message;
        return unhandledMessage;
      }
    }
  };
}
