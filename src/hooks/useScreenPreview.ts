'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { createPreviewMessage } from '@/lib/sdk-protocol';
import type { PreviewContent } from '@/types/sdk-message';

/** Marks the button that opens a screen's preview, so focus can return to it when the preview closes. */
export const PREVIEW_TOGGLE_ATTRIBUTE = 'data-preview-screen';

interface UseScreenPreviewOptions {
  requestPreview: (previewId: string, port: MessagePort) => void;
  requestPreviewClose: () => void;
  subscribeToPreviewClosed: (listener: (previewId: string) => void) => () => void;
}

interface OpenPreview {
  previewId: string;
  /** The widget's end of the channel. The SDK hands the other end to the preview iframe. */
  port: MessagePort;
  screenId: string;
}

function findPreviewToggle(screenId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${PREVIEW_TOGGLE_ATTRIBUTE}="${CSS.escape(screenId)}"]`);
}

/** Shows one saved screen at a time in the large preview panel the SDK opens next to the widget. */
export function useScreenPreview({ requestPreview, requestPreviewClose, subscribeToPreviewClosed }: UseScreenPreviewOptions) {
  const [screenId, setScreenId] = useState<string | null>(null);
  const preview = useRef<OpenPreview | null>(null);

  const show = useCallback((id: string, content: PreviewContent) => {
    const message = createPreviewMessage('preview:content', content);
    if (preview.current) {
      // An open preview shows the other screen in place: there is only ever one panel.
      preview.current.port.postMessage(message);
      preview.current.screenId = id;
    } else {
      const { port1, port2 } = new MessageChannel();
      const previewId = crypto.randomUUID();
      // The message waits on the port until the preview iframe has loaded and taken the other end.
      port1.postMessage(message);
      preview.current = { previewId, port: port1, screenId: id };
      requestPreview(previewId, port2);
    }
    setScreenId(id);
  }, [requestPreview]);

  const close = useCallback(() => {
    if (!preview.current) {
      return;
    }
    preview.current.port.close();
    preview.current = null;
    setScreenId(null);
    requestPreviewClose();
  }, [requestPreviewClose]);

  // The SDK reports every preview that ends: closed from inside it, by Escape, by a click outside it, or
  // together with the widget. One the widget closed itself is already forgotten here.
  useEffect(() => subscribeToPreviewClosed((previewId) => {
    const closed = preview.current;
    if (!closed || closed.previewId !== previewId) {
      return;
    }
    closed.port.close();
    preview.current = null;
    setScreenId(null);
    findPreviewToggle(closed.screenId)?.focus({ preventScroll: true });
  }), [subscribeToPreviewClosed]);

  return { screenId, show, close };
}
