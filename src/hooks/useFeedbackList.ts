'use client';

import { useCallback, useEffect, useState } from 'react';

import { getFeedbackList } from '@/lib/admin-api';
import { findAdminLoadStatus, type AdminLoadStatus } from '@/lib/admin-load-status';
import type { Feedback } from '@/types/feedback';

interface FeedbackListState {
  /** Which project and token this result was loaded for. */
  requestKey: string;
  items: Feedback[] | null;
  errorStatus: number | null;
  errorMessage: string;
}

interface UseFeedbackListInput {
  projectKey: string;
  token: string;
}

interface UseFeedbackListResult {
  status: AdminLoadStatus;
  items: Feedback[];
  errorMessage: string;
  reload: () => void;
}

export function useFeedbackList({ projectKey, token }: UseFeedbackListInput): UseFeedbackListResult {
  const [state, setState] = useState<FeedbackListState | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const requestKey = JSON.stringify([projectKey, token]);

  useEffect(() => {
    if (!token) {
      return;
    }
    let isCancelled = false;
    getFeedbackList({ projectKey, token }).then((result) => {
      if (isCancelled) {
        return;
      }
      if (result.ok) {
        setState({ requestKey, items: result.data.items, errorStatus: null, errorMessage: '' });
        return;
      }
      setState((previous) => ({
        requestKey,
        items: previous?.requestKey === requestKey ? previous.items : null,
        errorStatus: result.status,
        errorMessage: result.message,
      }));
    });
    return () => {
      isCancelled = true;
    };
  }, [projectKey, token, requestKey, reloadCount]);

  const reload = useCallback(() => setReloadCount((count) => count + 1), []);
  // A result for another project or token must never be shown under the current one.
  const currentState = state?.requestKey === requestKey ? state : null;
  const snapshot = currentState && { hasData: currentState.items !== null, errorStatus: currentState.errorStatus };

  return {
    status: findAdminLoadStatus(token, snapshot),
    items: currentState?.items ?? [],
    errorMessage: currentState?.errorMessage ?? '',
    reload,
  };
}
