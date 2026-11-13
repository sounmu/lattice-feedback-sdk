'use client';

import { useCallback, useEffect, useState } from 'react';

import { getFeedbackDetail, updateFeedback } from '@/lib/admin-api';
import { findAdminLoadStatus, type AdminLoadStatus } from '@/lib/admin-load-status';
import type { FeedbackDetailResponse, UpdateFeedbackInput } from '@/types/feedback';

interface FeedbackDetailState {
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
        setState({ detail: result.data, errorStatus: null, errorMessage: '' });
        return;
      }
      setState({ detail: null, errorStatus: result.status, errorMessage: result.message });
    });
    return () => {
      isCancelled = true;
    };
  }, [projectKey, token, id]);

  const save = useCallback(
    async (changes: UpdateFeedbackInput): Promise<boolean> => {
      setSaveStatus('saving');
      const result = await updateFeedback({ projectKey, token, id, changes });
      if (!result.ok) {
        setSaveStatus('failed');
        setSaveErrorMessage(result.message);
        return false;
      }
      setState({ detail: result.data, errorStatus: null, errorMessage: '' });
      setSaveStatus('saved');
      setSaveErrorMessage('');
      return true;
    },
    [projectKey, token, id],
  );

  const snapshot = state && { hasData: state.detail !== null, errorStatus: state.errorStatus };

  return {
    status: findAdminLoadStatus(token, snapshot),
    detail: state?.detail ?? null,
    errorMessage: state?.errorMessage ?? '',
    saveStatus,
    saveErrorMessage,
    save,
  };
}
