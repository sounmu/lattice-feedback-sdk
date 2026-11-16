import { Suspense } from 'react';

import { ScreenPreviewPanel } from '@/components/widget/ScreenPreviewPanel';

export default function WidgetPreviewPage() {
  return (
    <Suspense fallback={null}>
      <ScreenPreviewPanel />
    </Suspense>
  );
}
