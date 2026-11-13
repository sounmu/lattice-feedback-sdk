import { createHostToWidgetMessage, isWidgetToHostMessage } from '@/lib/sdk-protocol';
import { createCaptureUpdate, isCaptureCommand } from '@/lib/capture-protocol';
import { findCapturePolicy, type CapturePolicy } from '@/lib/capture-policy';
import { createCaptureController } from '@/sdk/capture-controller';
import { trackHistory } from '@/sdk/history-tracking';
import { copyReporter, isFeedbackReporter } from '@/sdk/reporter';
import { getPageContext } from '@/sdk/page-context';
import { captureScreen } from '@/sdk/screen-capture';
import { HOST_ELEMENT_STYLE, PANEL_OPEN_CLASS_NAME, SDK_STYLES } from '@/sdk/styles';
import type { FeedbackSdkInitOptions } from '@/sdk/types';
import type { FeedbackReporter } from '@/types/feedback';
import type { CaptureUpdateMessage, HostToWidgetMessage } from '@/types/sdk-message';

const LOG_PREFIX = '[LatticeFeedback]';
const HOST_ELEMENT_TAG_NAME = 'lattice-feedback-root';
const IFRAME_TITLE = 'Feedback';

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
  private isCapturingScreen = false;

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
    this.capturePolicy = findCapturePolicy(options.capturePolicy);
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
      console.warn(`${LOG_PREFIX} setUser() expects { id: string, name: string, email?: string } or null; ignoring.`);
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
    // The viewport may have changed since the iframe was created, so refresh on every open.
    this.updatePageContext();
    this.captureController?.setPanelVisible(true);
    window.addEventListener('resize', this.handleResize);
  }

  close(): void {
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
    this.stopResizeTracking();
    this.captureController?.setPanelVisible(false);
  }

  destroy(): void {
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
    launcherButton.textContent = 'Feedback';
    launcherButton.setAttribute('aria-expanded', 'false');
    launcherButton.addEventListener('click', this.handleLauncherClick);

    shadowRoot.append(styleElement, panelElement, launcherButton);
    document.body.appendChild(hostElement);

    this.hostElement = hostElement;
    this.panelElement = panelElement;
    this.captureController = createCaptureController({
      projectKey, policy: this.capturePolicy, root: shadowRoot,
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
  private async saveScreen(): Promise<void> {
    if (this.isCapturingScreen) {
      return;
    }
    if (this.capturePolicy && !this.capturePolicy.allowedPaths.includes(window.location.pathname)) {
      this.postToWidget(createHostToWidgetMessage('screen:capture-failed', { reason: 'page_not_allowed' }));
      return;
    }
    this.isCapturingScreen = true;
    try {
      const capture = await captureScreen(HOST_ELEMENT_TAG_NAME, {
        comments: this.captureController?.getCommentPinSources() ?? [],
        edits: this.captureController?.getEditMoveSources() ?? [],
      });
      this.postToWidget(createHostToWidgetMessage('screen:captured', capture));
    } catch (error) {
      console.warn(`${LOG_PREFIX} Saving the screen failed.`, error);
      this.postToWidget(createHostToWidgetMessage('screen:capture-failed', { reason: 'capture_failed' }));
    } finally {
      this.isCapturingScreen = false;
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
      this.captureController?.handleCommand(message);
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
        this.captureController?.reset();
        break;
      case 'screen:capture':
        void this.saveScreen();
        break;
      default: {
        const unhandledMessage: never = message;
        return unhandledMessage;
      }
    }
  };
}
