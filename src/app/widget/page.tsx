import { Suspense } from 'react';

import { FeedbackWidget } from '@/components/widget/FeedbackWidget';

export default function WidgetPage() {
  return (
    <Suspense fallback={null}>
      <FeedbackWidget />
    </Suspense>
  );
}
