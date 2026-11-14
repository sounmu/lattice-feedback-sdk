import { Suspense } from 'react';

import { FeedbackListPage } from '@/components/admin/FeedbackListPage';

export default function AdminFeedbackListRoute() {
  return (
    <Suspense>
      <FeedbackListPage />
    </Suspense>
  );
}
