'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { createWidgetToHostMessage, isHostToWidgetMessage } from '@/lib/sdk-protocol';
import { isCaptureUpdate } from '@/lib/capture-protocol';
import type {
  CaptureCommand,
  CaptureState,
  ScreenCapturedMessage,
  ScreenCaptureFailedMessage,
  WidgetToHostMessage,
} from '@/types/sdk-message';
import type { FeedbackReporter, PageContext } from '@/types/feedback';

export type ScreenCaptureResult = ScreenCapturedMessage | ScreenCaptureFailedMessage;
type ScreenCaptureListener = (result: ScreenCaptureResult) => void;
type CaptureUpdateListener = (state: CaptureState) => void;

interface HostBridgeConfig {
  projectKey: string;
  hostOrigin: string;
}

function findValidHostOrigin(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    if (url.origin !== value) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function useHostBridge() {
  const searchParams = useSearchParams();
  const [reporter, setReporter] = useState<FeedbackReporter | null>(null);
  const [page, setPage] = useState<PageContext | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [captureState, setCaptureState] = useState<CaptureState | null>(null);
  // A saved screen is several megabytes, so it is handed to its listener instead of kept in state.
  const screenCaptureListeners = useRef(new Set<ScreenCaptureListener>());
  const captureUpdateListeners = useRef(new Set<CaptureUpdateListener>());

  const projectKey = searchParams.get('projectKey');
  const hostOrigin = findValidHostOrigin(searchParams.get('hostOrigin'));

  const config = useMemo<HostBridgeConfig | null>(() => {
    if (!projectKey || !hostOrigin) {
      return null;
    }
    return { projectKey, hostOrigin };
  }, [projectKey, hostOrigin]);

  const postToHost = useCallback(
    (message: WidgetToHostMessage | CaptureCommand) => {
      if (!config) {
        return;
      }
      window.parent.postMessage(message, config.hostOrigin);
    },
    [config],
  );

  useEffect(() => {
    if (!config) {
      return;
    }
    const expectedOrigin = config.hostOrigin;

    function handleMessage(event: MessageEvent) {
      if (event.origin !== expectedOrigin || event.source !== window.parent) {
        return;
      }
      if (isCaptureUpdate(event.data)) {
        const state = event.data.payload;
        setCaptureState(state);
        captureUpdateListeners.current.forEach((listener) => listener(state));
        return;
      }
      if (!isHostToWidgetMessage(event.data)) {
        return;
      }
      const message = event.data;
      switch (message.type) {
        case 'init':
          setReporter(message.payload.reporter);
          setPage(message.payload.page);
          setIsInitialized(true);
          break;
        case 'reporter:update':
          setReporter(message.payload.reporter);
          break;
        case 'page:update':
          setPage(message.payload.page);
          break;
        case 'screen:captured':
        case 'screen:capture-failed':
          screenCaptureListeners.current.forEach((listener) => listener(message));
          break;
      }
    }

    window.addEventListener('message', handleMessage);
    window.parent.postMessage(createWidgetToHostMessage('ready', {}), expectedOrigin);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [config]);

  const notifyClose = useCallback(() => {
    postToHost(createWidgetToHostMessage('close', {}));
  }, [postToHost]);

  const notifySubmitted = useCallback(
    (feedbackId: string) => {
      postToHost(createWidgetToHostMessage('submitted', { feedbackId }));
    },
    [postToHost],
  );

  const subscribeToScreenCapture = useCallback((listener: ScreenCaptureListener) => {
    const listeners = screenCaptureListeners.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const subscribeToCaptureUpdate = useCallback((listener: CaptureUpdateListener) => {
    const listeners = captureUpdateListeners.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const requestScreenCapture = useCallback((requestId: string) => {
    postToHost(createWidgetToHostMessage('screen:capture', { requestId }));
  }, [postToHost]);

  const errorMessage = config ? null : 'projectKey 또는 hostOrigin이 올바르지 않습니다.';

  return {
    config,
    errorMessage,
    reporter,
    page,
    isInitialized,
    captureState,
    sendCaptureCommand: postToHost,
    subscribeToScreenCapture,
    subscribeToCaptureUpdate,
    requestScreenCapture,
    notifyClose,
    notifySubmitted,
  };
}
