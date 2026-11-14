'use client';

import { AdminStatusGate } from '@/components/admin/AdminStatusGate';
import { FeedbackDetailView } from '@/components/admin/FeedbackDetailView';
import { useFeedbackDetail } from '@/hooks/useFeedbackDetail';
import type { UpdateFeedbackInput } from '@/types/feedback';

interface FeedbackDetailPaneProps {
  projectKey: string;
  token: string;
  id: string;
  onSaved: () => void;
}

/** The chosen feedback, shown next to the list. A save here is reported, so the list can refresh its badges and counts. */
export function FeedbackDetailPane({ projectKey, token, id, onSaved }: FeedbackDetailPaneProps) {
  const { status, detail, errorMessage, saveStatus, saveErrorMessage, save } = useFeedbackDetail({ projectKey, token, id });

  async function handleSave(changes: UpdateFeedbackInput): Promise<boolean> {
    const isSaved = await save(changes);
    if (isSaved) {
      onSaved();
    }
    return isSaved;
  }

  return (
    <AdminStatusGate status={status} errorMessage={errorMessage}>
      {detail ? (
        <FeedbackDetailView
          detail={detail}
          projectKey={projectKey}
          saveStatus={saveStatus}
          saveErrorMessage={saveErrorMessage}
          onSave={handleSave}
          isEmbedded
        />
      ) : null}
    </AdminStatusGate>
  );
}
