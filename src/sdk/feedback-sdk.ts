import { createHostToWidgetMessage, isWidgetToHostMessage } from '@/lib/sdk-protocol';
import { getPageContext } from '@/sdk/page-context';
import { HOST_ELEMENT_STYLE, PANEL_OPEN_CLASS_NAME, SDK_STYLES } from '@/sdk/styles';
import type { FeedbackSdkInitOptions } from '@/sdk/types';
import type { FeedbackReporter } from '@/types/feedback';
import type { HostToWidgetMessage } from '@/types/sdk-message';

const LOG_PREFIX = '[LatticeFeedback]';
const HOST_ELEMENT_TAG_NAME = 'lattice-feedback-root';
const IFRAME_TITLE = 'Feedback';

type HistoryStateMethod = History['pushState'];

function isFeedbackReporter(value: unknown): value is FeedbackReporter {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') {
    return false;
  }
  return candidate.email === undefined || typeof candidate.email === 'string';
}

function copyReporter(reporter: FeedbackReporter): FeedbackReporter {
  if (reporter.email === undefined) {
    return { id: reporter.id, name: reporter.name };
  }
  return { id: reporter.id, name: reporter.name, email: reporter.email };
}

export function buildWidgetUrl(appOrigin: string, projectKey: string, hostOrigin: string): string {
  const parameters = new URLSearchParams({ projectKey, hostOrigin });
  return `${appOrigin}/widget?${parameters.toString()}`;
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
  private originalPushState: HistoryStateMethod | null = null;
  private originalReplaceState: HistoryStateMethod | null = null;
  private wrappedPushState: HistoryStateMethod | null = null;
  private wrappedReplaceState: HistoryStateMethod | null = null;
  private pendingResizeFrame: number | null = null;

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
    window.addEventListener('message', this.handleMessage);
    window.addEventListener('popstate', this.handleNavigation);
    this.wrapHistory();
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
    this.handleNavigation();
    window.addEventListener('resize', this.handleResize);
  }

  close(): void {
    if (!this.panelElement || !this.launcherButton) {
      return;
    }
    this.panelElement.classList.remove(PANEL_OPEN_CLASS_NAME);
    this.launcherButton.setAttribute('aria-expanded', 'false');
    this.isPanelOpen = false;
    this.stopResizeTracking();
  }

  destroy(): void {
    window.removeEventListener('message', this.handleMessage);
    window.removeEventListener('popstate', this.handleNavigation);
    document.removeEventListener('DOMContentLoaded', this.handleDomContentLoaded);
    this.stopResizeTracking();
    this.launcherButton?.removeEventListener('click', this.handleLauncherClick);
    this.restoreHistory();
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
    iframeElement.src = buildWidgetUrl(this.appOrigin, this.projectKey, window.location.origin);
    this.panelElement.appendChild(iframeElement);
    this.iframeElement = iframeElement;
  }

  private postToWidget(message: HostToWidgetMessage): void {
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
  }

  private wrapHistory(): void {
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    const wrappedPushState: HistoryStateMethod = (...parameters) => {
      originalPushState.apply(window.history, parameters);
      this.handleNavigation();
    };
    const wrappedReplaceState: HistoryStateMethod = (...parameters) => {
      originalReplaceState.apply(window.history, parameters);
      this.handleNavigation();
    };
    window.history.pushState = wrappedPushState;
    window.history.replaceState = wrappedReplaceState;
    this.originalPushState = originalPushState;
    this.originalReplaceState = originalReplaceState;
    this.wrappedPushState = wrappedPushState;
    this.wrappedReplaceState = wrappedReplaceState;
  }

  private restoreHistory(): void {
    // Only restore when still ours, so a wrapper installed later by the host is not clobbered.
    if (this.originalPushState && window.history.pushState === this.wrappedPushState) {
      window.history.pushState = this.originalPushState;
    }
    if (this.originalReplaceState && window.history.replaceState === this.wrappedReplaceState) {
      window.history.replaceState = this.originalReplaceState;
    }
    this.originalPushState = null;
    this.originalReplaceState = null;
    this.wrappedPushState = null;
    this.wrappedReplaceState = null;
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
      this.handleNavigation();
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
    if (this.isDestroyed || !this.isWidgetReady) {
      return;
    }
    this.postToWidget(createHostToWidgetMessage('page:update', { page: getPageContext() }));
  };

  private readonly handleMessage = (event: MessageEvent): void => {
    if (event.origin !== this.appOrigin) {
      return;
    }
    if (!this.iframeElement || event.source !== this.iframeElement.contentWindow) {
      return;
    }
    const message: unknown = event.data;
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
        break;
      default: {
        const unhandledMessage: never = message;
        return unhandledMessage;
      }
    }
  };
}
