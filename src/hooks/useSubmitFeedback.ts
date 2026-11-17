'use client';

import { useCallback, useState } from 'react';

import type { ApiErrorResponse, CreateFeedbackInput, CreateFeedbackResponse } from '@/types/feedback';
import { isWithinFeedbackBytes } from '@/lib/feedback-limits';

export type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

const FALLBACK_ERROR_MESSAGE = '잠시 후 다시 시도해 주세요. 작성한 내용은 그대로 남아 있어요.';
const VERIFICATION_REQUIRED_MESSAGE = '로그인한 사용자만 피드백을 보낼 수 있어요. 로그인 후 다시 시도해 주세요.';

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
      if (!isWithinFeedbackBytes(input)) {
        setErrorMessage('피드백과 첨부 자료가 너무 큽니다. 본문이나 첨부를 줄여 주세요.');
        setStatus('error');
        return null;
      }
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 401) {
        setErrorMessage(VERIFICATION_REQUIRED_MESSAGE);
        setStatus('error');
        return null;
      }
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
