import { Suspense } from 'react';

import { ScreenSnapshotViewer } from '@/components/admin/ScreenSnapshotViewer';

export default function ScreenSnapshotPage() {
  return (
    <Suspense fallback={null}>
      <ScreenSnapshotViewer />
    </Suspense>
  );
}
