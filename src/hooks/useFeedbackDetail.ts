'use client';

import { useCallback, useEffect, useState } from 'react';

import { getFeedbackDetail, updateFeedback } from '@/lib/admin-api';
import { findAdminLoadStatus, type AdminLoadStatus } from '@/lib/admin-load-status';
import type { FeedbackDetailResponse, UpdateFeedbackInput } from '@/types/feedback';

interface FeedbackDetailState {
  /** Which project, token and feedback this result was loaded for. */
  requestKey: string;
  detail: FeedbackDetailResponse | null;
  errorStatus: number | null;
  errorMessage: string;
}

interface UseFeedbackDetailInput {
  projectKey: string;
  token: string;
  id: string;
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

interface UseFeedbackDetailResult {
  status: AdminLoadStatus;
  detail: FeedbackDetailResponse | null;
  errorMessage: string;
  saveStatus: SaveStatus;
  saveErrorMessage: string;
  save: (changes: UpdateFeedbackInput) => Promise<boolean>;
}

export function useFeedbackDetail({ projectKey, token, id }: UseFeedbackDetailInput): UseFeedbackDetailResult {
  const [state, setState] = useState<FeedbackDetailState | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveErrorMessage, setSaveErrorMessage] = useState('');
  const requestKey = JSON.stringify([projectKey, token, id]);

  useEffect(() => {
    if (!token) {
      return;
    }
    let isCancelled = false;
    getFeedbackDetail({ projectKey, token, id }).then((result) => {
      if (isCancelled) {
        return;
      }
      if (result.ok) {
        setState({ requestKey, detail: result.data, errorStatus: null, errorMessage: '' });
        return;
      }
      setState({ requestKey, detail: null, errorStatus: result.status, errorMessage: result.message });
    });
    return () => {
      isCancelled = true;
    };
  }, [projectKey, token, id, requestKey]);

  const save = useCallback(
    async (changes: UpdateFeedbackInput): Promise<boolean> => {
      setSaveStatus('saving');
      const result = await updateFeedback({ projectKey, token, id, changes });
      if (!result.ok) {
        setSaveStatus('failed');
        setSaveErrorMessage(result.message);
        return false;
      }
      setState({ requestKey, detail: result.data, errorStatus: null, errorMessage: '' });
      setSaveStatus('saved');
      setSaveErrorMessage('');
      return true;
    },
    [projectKey, token, id, requestKey],
  );

  // A result for another project, token or feedback must never be shown under the current one.
  const currentState = state?.requestKey === requestKey ? state : null;
  const snapshot = currentState && { hasData: currentState.detail !== null, errorStatus: currentState.errorStatus };

  return {
    status: findAdminLoadStatus(token, snapshot),
    detail: currentState?.detail ?? null,
    errorMessage: currentState?.errorMessage ?? '',
    saveStatus,
    saveErrorMessage,
    save,
  };
}
