import { Suspense } from 'react';

import { FeedbackDetailPage } from '@/components/admin/FeedbackDetailPage';

export default function AdminFeedbackDetailRoute() {
  return (
    <Suspense>
      <FeedbackDetailPage />
    </Suspense>
  );
}
