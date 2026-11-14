'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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

interface SaveState {
  /** Which project, token and feedback this save was made for. */
  requestKey: string;
  status: SaveStatus;
  errorMessage: string;
}

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
  const [saveState, setSaveState] = useState<SaveState | null>(null);
  const requestKey = JSON.stringify([projectKey, token, id]);
  const latestRequestKey = useRef(requestKey);

  useEffect(() => {
    latestRequestKey.current = requestKey;
  }, [requestKey]);

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
      setSaveState({ requestKey, status: 'saving', errorMessage: '' });
      const result = await updateFeedback({ projectKey, token, id, changes });
      // Settle this save even if the admin moved on, so coming back does not find the form still locked.
      const settled: SaveState = result.ok
        ? { requestKey, status: 'saved', errorMessage: '' }
        : { requestKey, status: 'failed', errorMessage: result.message };
      setSaveState((previous) => (previous?.requestKey === requestKey ? settled : previous));
      // The token, project or feedback changed while saving: the page now shows another request.
      if (latestRequestKey.current !== requestKey || !result.ok) {
        return false;
      }
      setState({ requestKey, detail: result.data, errorStatus: null, errorMessage: '' });
      return true;
    },
    [projectKey, token, id, requestKey],
  );

  // A result for another project, token or feedback must never be shown under the current one.
  const currentState = state?.requestKey === requestKey ? state : null;
  const snapshot = currentState && { hasData: currentState.detail !== null, errorStatus: currentState.errorStatus };
  const currentSaveState = saveState?.requestKey === requestKey ? saveState : null;

  return {
    status: findAdminLoadStatus(token, snapshot),
    detail: currentState?.detail ?? null,
    errorMessage: currentState?.errorMessage ?? '',
    saveStatus: currentSaveState?.status ?? 'idle',
    saveErrorMessage: currentSaveState?.errorMessage ?? '',
    save,
  };
}
