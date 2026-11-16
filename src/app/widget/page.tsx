import { Suspense } from 'react';

import { WidgetSkeleton } from '@/app/widget/WidgetSkeleton';
import { FeedbackWidget } from '@/components/widget/FeedbackWidget';

export default function WidgetPage() {
  return (
    <Suspense fallback={<WidgetSkeleton />}>
      <FeedbackWidget />
    </Suspense>
  );
}
