'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { createWidgetToHostMessage, isHostToWidgetMessage } from '@/lib/sdk-protocol';
import type { WidgetToHostMessage } from '@/types/sdk-message';
import type { FeedbackReporter, PageContext } from '@/types/feedback';

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

  const projectKey = searchParams.get('projectKey');
  const hostOrigin = findValidHostOrigin(searchParams.get('hostOrigin'));

  const config = useMemo<HostBridgeConfig | null>(() => {
    if (!projectKey || !hostOrigin) {
      return null;
    }
    return { projectKey, hostOrigin };
  }, [projectKey, hostOrigin]);

  const postToHost = useCallback(
    (message: WidgetToHostMessage) => {
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

  const errorMessage = config ? null : 'projectKey 또는 hostOrigin이 올바르지 않습니다.';

  return {
    config,
    errorMessage,
    reporter,
    page,
    isInitialized,
    notifyClose,
    notifySubmitted,
  };
}
