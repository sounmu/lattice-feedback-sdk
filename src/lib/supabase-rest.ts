import { z } from 'zod';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';

const REQUEST_TIMEOUT_MS = 10_000;

export interface SupabaseConfiguration {
  url: string;
  secretKey: string;
}

const supabaseConfigurationSchema = z.object({
  url: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  }),
  secretKey: z.string().startsWith('sb_secret_'),
});

export function getSupabaseConfiguration(): SupabaseConfiguration {
  const configuration = supabaseConfigurationSchema.safeParse({
    url: process.env.SUPABASE_URL,
    secretKey: process.env.SUPABASE_SECRET_KEY,
  });
  if (!configuration.success) {
    throw new FeedbackStorageUnavailableError();
  }
  return configuration.data;
}

export async function requestSupabaseRows(
  configuration: SupabaseConfiguration,
  table: string,
  parameters: Record<string, string>,
  options: RequestInit = {},
  extraPreferences: readonly string[] = [],
): Promise<unknown> {
  const endpoint = new URL(`/rest/v1/${table}`, configuration.url);
  endpoint.search = new URLSearchParams(parameters).toString();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      ...options,
      headers: {
        apikey: configuration.secretKey,
        'Content-Type': 'application/json',
        Prefer: ['return=representation', ...extraPreferences].join(','),
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new FeedbackStorageUnavailableError();
    }
    throw error;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new FeedbackStorageUnavailableError();
  }
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof Error) {
      throw new FeedbackStorageUnavailableError();
    }
    throw error;
  }
}
