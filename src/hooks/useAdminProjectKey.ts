'use client';

import { useSearchParams } from 'next/navigation';

import { DEFAULT_ADMIN_PROJECT_KEY } from '@/lib/admin-token';

/** Reads ?projectKey= from the URL, the same way the saved screen viewer does. */
export function useAdminProjectKey(): string {
  const searchParams = useSearchParams();
  return searchParams.get('projectKey') ?? DEFAULT_ADMIN_PROJECT_KEY;
}
