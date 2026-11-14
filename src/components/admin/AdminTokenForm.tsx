'use client';

import { useState, type FormEvent } from 'react';

interface AdminTokenFormProps {
  onSubmit: (token: string) => void;
  /** Shown when the saved token was rejected. */
  errorMessage?: string;
}

export function AdminTokenForm({ onSubmit, errorMessage }: AdminTokenFormProps) {
  const [draft, setDraft] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = draft.trim();
    if (token) {
      onSubmit(token);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto mt-10 flex max-w-md flex-col gap-3 rounded-2xl border border-(--admin-border) bg-(--admin-surface) p-6"
    >
      <h1 className="text-lg font-bold">관리자 토큰을 입력해 주세요</h1>
      <p className="text-(--admin-text-sub)">토큰은 이 브라우저 탭에만 저장되고, 탭을 닫으면 사라져요.</p>
      <label htmlFor="admin-token" className="text-sm font-semibold">
        관리자 토큰
      </label>
      <input
        id="admin-token"
        type="password"
        autoComplete="off"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="min-h-11 rounded-[10px] border border-(--admin-border) px-3 focus:outline-2 focus:outline-(--admin-primary)"
      />
      {errorMessage ? (
        <p role="alert" className="text-sm text-(--admin-danger)">
          {errorMessage}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={!draft.trim()}
        className="min-h-11 rounded-[10px] bg-(--admin-primary) font-semibold text-white hover:bg-(--admin-primary-hover) disabled:opacity-50"
      >
        확인
      </button>
    </form>
  );
}
