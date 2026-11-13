'use client';

import { useCallback, useEffect, useState } from 'react';

import { getFeedbackList } from '@/lib/admin-api';
import { findAdminLoadStatus, type AdminLoadStatus } from '@/lib/admin-load-status';
import type { Feedback } from '@/types/feedback';

interface FeedbackListState {
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
        setState({ items: result.data.items, errorStatus: null, errorMessage: '' });
        return;
      }
      setState((previous) => ({ items: previous?.items ?? null, errorStatus: result.status, errorMessage: result.message }));
    });
    return () => {
      isCancelled = true;
    };
  }, [projectKey, token, reloadCount]);

  const reload = useCallback(() => setReloadCount((count) => count + 1), []);
  const snapshot = state && { hasData: state.items !== null, errorStatus: state.errorStatus };

  return {
    status: findAdminLoadStatus(token, snapshot),
    items: state?.items ?? [],
    errorMessage: state?.errorMessage ?? '',
    reload,
  };
}
