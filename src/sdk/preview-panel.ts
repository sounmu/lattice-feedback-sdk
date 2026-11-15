// The large preview of a saved screen: a second panel on the host page, rendered inside the SDK ShadowRoot
// so saved screens and Flow replays leave it out. It holds a second iframe of the app. The screen reaches
// that iframe over the widget's MessagePort, which this module passes on without reading from it.
import { createPreviewMessage, isPreviewToHostMessage } from '@/lib/sdk-protocol';
import { PANEL_BOTTOM, PANEL_EDGE, PANEL_WIDTH, PHONE_MEDIA_QUERY, SDK_Z_INDEX } from '@/sdk/styles';
import { SDK_RADIUS, SDK_SHADOW, SDK_THEME } from '@/sdk/theme-tokens';

export interface PreviewPanelOptions {
  root: ShadowRoot;
  /** The widget panel. The dimmer goes right before it, so it covers the page and leaves the widget in view. */
  widgetPanel: Element;
  appOrigin: string;
  projectKey: string;
  /** Called once for every preview that ends, whoever closed it. */
  onClose: (previewId: string) => void;
}

export interface PreviewPanel {
  /** Opens a preview in place of one that is open. The port goes to the preview iframe once it can listen. */
  open(previewId: string, port: MessagePort): void;
  close(): void;
  /** Takes a message that came from the app's origin. False when it is not from the preview iframe. */
  handleMessage(event: MessageEvent): boolean;
  destroy(): void;
}

interface OpenPreview {
  previewId: string;
  /** Null once it has been handed to the iframe. */
  port: MessagePort | null;
  backdrop: HTMLDivElement;
  panel: HTMLDivElement;
  iframe: HTMLIFrameElement;
}

const IFRAME_TITLE = 'Feedback preview';
const PREVIEW_PATH = '/widget/preview';
const WIDGET_GAP = '16px';
/** Wide enough for the preview to sit beside the widget. Narrower, it lies over the widget, above the launcher. */
const BESIDE_WIDGET_MEDIA_QUERY = '(min-width: 1024px)';
const KEY_CAPTURE: AddEventListenerOptions = { capture: true };

// Both layers share the widget panel's z-index and are ordered in the tree instead: the dimmer comes
// before the widget panel and paints under it, the preview comes last and paints over everything else.
const PREVIEW_STYLES = `
.preview-backdrop {
  position: fixed;
  inset: 0;
  z-index: ${SDK_Z_INDEX};
  background: ${SDK_THEME.overlay};
}

.preview-panel {
  position: fixed;
  top: ${PANEL_EDGE};
  right: ${PANEL_EDGE};
  bottom: ${PANEL_BOTTOM};
  left: ${PANEL_EDGE};
  z-index: ${SDK_Z_INDEX};
  overflow: hidden;
  border-radius: ${SDK_RADIUS.page};
  background: ${SDK_THEME.surface};
  box-shadow: 0 0 0 1px ${SDK_THEME.border}, ${SDK_SHADOW.panel};
}

.preview-panel iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}

@media ${BESIDE_WIDGET_MEDIA_QUERY} {
  .preview-panel {
    right: calc(${PANEL_EDGE} + ${PANEL_WIDTH} + ${WIDGET_GAP});
    bottom: ${PANEL_EDGE};
  }
}

/* On a phone the preview takes the whole screen. Its own close button leads back to the widget. */
@media ${PHONE_MEDIA_QUERY} {
  .preview-panel {
    inset: 0;
    border-radius: 0;
    box-shadow: none;
  }
}
`;

export function createPreviewPanel(options: PreviewPanelOptions): PreviewPanel {
  const styleElement = document.createElement('style');
  styleElement.textContent = PREVIEW_STYLES;
  options.root.append(styleElement);
  let preview: OpenPreview | null = null;
  let isDestroyed = false;

  function removePreview(): string | null {
    if (!preview) {
      return null;
    }
    const { previewId, port, backdrop, panel } = preview;
    preview = null;
    window.removeEventListener('keydown', handleKeyDown, KEY_CAPTURE);
    backdrop.removeEventListener('click', close);
    backdrop.remove();
    panel.remove();
    // A port the iframe never took would keep the widget's end waiting.
    port?.close();
    return previewId;
  }

  function close(): void {
    const previewId = removePreview();
    if (previewId !== null) {
      options.onClose(previewId);
    }
  }

  // The preview is the topmost layer, so Escape pressed on the page closes it and goes no further.
  // Escape pressed inside the preview or the widget is handled there: key events do not leave an iframe.
  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.isComposing) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
  }

  function open(previewId: string, port: MessagePort): void {
    if (isDestroyed) {
      port.close();
      return;
    }
    close();
    const backdrop = document.createElement('div');
    backdrop.className = 'preview-backdrop';
    backdrop.addEventListener('click', close);
    const panel = document.createElement('div');
    panel.className = 'preview-panel';
    const iframe = document.createElement('iframe');
    iframe.title = IFRAME_TITLE;
    // Keep host query strings out of the Referer header sent to the app server.
    iframe.referrerPolicy = 'origin';
    const parameters = new URLSearchParams({ projectKey: options.projectKey, hostOrigin: window.location.origin });
    iframe.src = `${options.appOrigin}${PREVIEW_PATH}?${parameters.toString()}`;
    panel.append(iframe);
    options.root.insertBefore(backdrop, options.widgetPanel);
    options.root.append(panel);
    window.addEventListener('keydown', handleKeyDown, KEY_CAPTURE);
    preview = { previewId, port, backdrop, panel, iframe };
  }

  function handleMessage(event: MessageEvent): boolean {
    if (!preview || event.source !== preview.iframe.contentWindow) {
      return false;
    }
    const message: unknown = event.data;
    if (!isPreviewToHostMessage(message)) {
      return true;
    }
    if (message.type === 'preview:close') {
      close();
      return true;
    }
    // The iframe can listen now. The port is handed over once, so a document that loads in the iframe
    // later gets none.
    const { port, iframe } = preview;
    if (port) {
      preview.port = null;
      iframe.contentWindow?.postMessage(createPreviewMessage('preview:connect', {}), options.appOrigin, [port]);
      // Keyboard focus follows the preview in; the preview puts it on its first control.
      iframe.focus({ preventScroll: true });
    }
    return true;
  }

  return {
    open,
    close,
    handleMessage,
    destroy(): void {
      if (isDestroyed) {
        return;
      }
      isDestroyed = true;
      removePreview();
      styleElement.remove();
    },
  };
}
