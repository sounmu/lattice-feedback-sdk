'use client';

import { useCallback, useState } from 'react';

import type { ApiErrorResponse, CreateFeedbackInput, CreateFeedbackResponse } from '@/types/feedback';

export type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

const FALLBACK_ERROR_MESSAGE = '전송에 실패했습니다. 잠시 후 다시 시도해주세요.';

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return false;
  }
  const error = (value as { error: unknown }).error;
  return typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string';
}

export function useSubmitFeedback() {
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submit = useCallback(async (input: CreateFeedbackInput): Promise<CreateFeedbackResponse | null> => {
    setStatus('submitting');
    setErrorMessage(null);
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setErrorMessage(isApiErrorResponse(body) ? body.error.message : FALLBACK_ERROR_MESSAGE);
        setStatus('error');
        return null;
      }
      setStatus('success');
      return body as CreateFeedbackResponse;
    } catch {
      setErrorMessage(FALLBACK_ERROR_MESSAGE);
      setStatus('error');
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setErrorMessage(null);
  }, []);

  return { submit, reset, status, errorMessage };
}
