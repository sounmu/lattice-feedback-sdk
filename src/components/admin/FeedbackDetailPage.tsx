'use client';

import { useParams } from 'next/navigation';

import { AdminFrame } from '@/components/admin/AdminFrame';
import { AdminStatusGate } from '@/components/admin/AdminStatusGate';
import { FeedbackDetailView } from '@/components/admin/FeedbackDetailView';
import { useAdminProjectKey } from '@/hooks/useAdminProjectKey';
import { useAdminToken } from '@/hooks/useAdminToken';
import { useFeedbackDetail } from '@/hooks/useFeedbackDetail';
import { saveAdminToken } from '@/lib/admin-token';

export function FeedbackDetailPage() {
  const params = useParams<{ id: string }>();
  const projectKey = useAdminProjectKey();
  const token = useAdminToken();
  const { status, detail, errorMessage, saveStatus, saveErrorMessage, save } = useFeedbackDetail({ projectKey, token, id: params.id });

  return (
    <AdminFrame projectKey={projectKey} hasToken={token !== ''} onSignOut={() => saveAdminToken('')}>
      <AdminStatusGate status={status} errorMessage={errorMessage}>
        {detail ? (
          <FeedbackDetailView detail={detail} projectKey={projectKey} saveStatus={saveStatus} saveErrorMessage={saveErrorMessage} onSave={save} />
        ) : null}
      </AdminStatusGate>
    </AdminFrame>
  );
}
