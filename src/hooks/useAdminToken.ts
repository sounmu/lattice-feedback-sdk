'use client';

import { useSyncExternalStore } from 'react';

import { getServerAdminToken, getStoredAdminToken, subscribeToAdminToken } from '@/lib/admin-token';

export function useAdminToken(): string {
  return useSyncExternalStore(subscribeToAdminToken, getStoredAdminToken, getServerAdminToken);
}
