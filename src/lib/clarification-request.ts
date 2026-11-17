// The widget's side of the questions asked before sending. Questions only help: any failure means none,
// and the feedback is sent as it is.
import { clarifyResponseSchema } from '@/lib/validation/clarification-schema';
import type { ClarifyInput, ClarifyResponse } from '@/types/feedback';

// The server stops waiting for the model after at most 20 seconds; this only guards a hung connection.
const CLIENT_TIMEOUT_MS = 25_000;
const NO_QUESTIONS: ClarifyResponse = { questions: [], model: null };

export async function requestClarification(input: ClarifyInput): Promise<ClarifyResponse> {
  try {
    const response = await fetch('/api/clarify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });
    if (!response.ok) {
      return NO_QUESTIONS;
    }
    const parsed = clarifyResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : NO_QUESTIONS;
  } catch {
    return NO_QUESTIONS;
  }
}
