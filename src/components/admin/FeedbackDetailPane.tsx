'use client';

import { AdminStatusGate } from '@/components/admin/AdminStatusGate';
import { FeedbackDetailView } from '@/components/admin/FeedbackDetailView';
import { useFeedbackDetail } from '@/hooks/useFeedbackDetail';

interface FeedbackDetailPaneProps {
  projectKey: string;
  token: string;
  id: string;
  /** Called after every save that reached the server, so the list can refresh its badges and counts. */
  onSaved: () => void;
}

/** The chosen feedback, shown next to the list. */
export function FeedbackDetailPane({ projectKey, token, id, onSaved }: FeedbackDetailPaneProps) {
  const { status, detail, errorMessage, saveStatus, saveErrorMessage, save } = useFeedbackDetail({ projectKey, token, id, onSaved });

  return (
    <AdminStatusGate status={status} errorMessage={errorMessage}>
      {detail ? (
        <FeedbackDetailView
          detail={detail}
          projectKey={projectKey}
          saveStatus={saveStatus}
          saveErrorMessage={saveErrorMessage}
          onSave={save}
          isEmbedded
        />
      ) : null}
    </AdminStatusGate>
  );
}
