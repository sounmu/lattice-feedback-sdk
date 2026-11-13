'use client';

import { useState } from 'react';

import { AdminFrame } from '@/components/admin/AdminFrame';
import { AdminStatusGate } from '@/components/admin/AdminStatusGate';
import { FeedbackListView } from '@/components/admin/FeedbackListView';
import { useAdminProjectKey } from '@/hooks/useAdminProjectKey';
import { useAdminToken } from '@/hooks/useAdminToken';
import { useFeedbackList } from '@/hooks/useFeedbackList';
import { saveAdminToken } from '@/lib/admin-token';

export function FeedbackListPage() {
  const projectKey = useAdminProjectKey();
  const token = useAdminToken();
  const { status, items, errorMessage, reload } = useFeedbackList({ projectKey, token });
  const [nowTimestamp] = useState(() => Date.now());

  return (
    <AdminFrame projectKey={projectKey} hasToken={token !== ''} onSignOut={() => saveAdminToken('')}>
      <AdminStatusGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <FeedbackListView items={items} projectKey={projectKey} nowTimestamp={nowTimestamp} onReload={reload} />
      </AdminStatusGate>
    </AdminFrame>
  );
}
