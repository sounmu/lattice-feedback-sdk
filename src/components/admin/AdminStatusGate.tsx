'use client';

import type { ReactNode } from 'react';

import { AdminTokenForm } from '@/components/admin/AdminTokenForm';
import type { AdminLoadStatus } from '@/lib/admin-load-status';
import { saveAdminToken } from '@/lib/admin-token';

interface AdminStatusGateProps {
  status: AdminLoadStatus;
  errorMessage: string;
  onRetry?: () => void;
  children: ReactNode;
}

const UNAUTHORIZED_MESSAGE = '관리자 토큰이 올바르지 않아요. 다시 입력해 주세요.';

/** Shows the token form, a loading note or an error instead of the page when it cannot show data yet. */
export function AdminStatusGate({ status, errorMessage, onRetry, children }: AdminStatusGateProps) {
  if (status === 'unauthenticated') {
    return <AdminTokenForm onSubmit={saveAdminToken} />;
  }
  if (status === 'unauthorized') {
    return <AdminTokenForm onSubmit={saveAdminToken} errorMessage={UNAUTHORIZED_MESSAGE} />;
  }
  if (status === 'loading') {
    return <p className="py-16 text-center text-(--admin-text-muted)">불러오는 중이에요…</p>;
  }
  if (status === 'error') {
    return (
      <div role="alert" className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 rounded-2xl border border-(--admin-border) bg-(--admin-surface) p-6 text-center">
        <p className="text-(--admin-danger)">{errorMessage}</p>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="min-h-11 rounded-[10px] bg-(--admin-primary) px-5 font-semibold text-white">
            다시 시도
          </button>
        ) : null}
      </div>
    );
  }
  return <>{children}</>;
}
