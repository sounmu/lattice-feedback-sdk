'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { findValidHostOrigin } from '@/hooks/useHostBridge';
import { createPreviewMessage, isPreviewConnectMessage, isPreviewContentMessage } from '@/lib/sdk-protocol';
import type { PreviewContent } from '@/types/sdk-message';

export type PreviewState =
  | { status: 'waiting' }
  /** The revision changes whenever the widget sends another screen to show in place of the last one. */
  | { status: 'ready'; content: PreviewContent; revision: number }
  | { status: 'failed' };

const FAILED: PreviewState = { status: 'failed' };

/**
 * The preview iframe's side of the exchange: it tells the SDK it can listen, takes the widget's port from
 * the SDK's answer, and reads the screens to show from that port. The SDK is trusted only as far as its
 * origin and window; what arrives on the port is checked by shape before it is drawn.
 */
export function usePreviewContent() {
  const hostOrigin = findValidHostOrigin(useSearchParams().get('hostOrigin'));
  const [state, setState] = useState<PreviewState>({ status: 'waiting' });

  useEffect(() => {
    if (!hostOrigin) {
      return;
    }
    let port: MessagePort | null = null;

    function handleContent(event: MessageEvent) {
      const message: unknown = event.data;
      if (!isPreviewContentMessage(message)) {
        setState(FAILED);
        return;
      }
      setState((previous) => ({
        status: 'ready',
        content: message.payload,
        revision: previous.status === 'ready' ? previous.revision + 1 : 0,
      }));
    }

    function handleMessage(event: MessageEvent) {
      if (event.origin !== hostOrigin || event.source !== window.parent || port !== null) {
        return;
      }
      if (!isPreviewConnectMessage(event.data) || event.ports.length !== 1) {
        return;
      }
      [port] = event.ports;
      port.onmessage = handleContent;
    }

    window.addEventListener('message', handleMessage);
    window.parent.postMessage(createPreviewMessage('preview:ready', {}), hostOrigin);
    return () => {
      window.removeEventListener('message', handleMessage);
      port?.close();
    };
  }, [hostOrigin]);

  const requestClose = useCallback(() => {
    if (hostOrigin) {
      window.parent.postMessage(createPreviewMessage('preview:close', {}), hostOrigin);
    }
  }, [hostOrigin]);

  return { state: hostOrigin ? state : FAILED, requestClose };
}
