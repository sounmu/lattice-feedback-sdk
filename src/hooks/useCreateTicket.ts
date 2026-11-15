'use client';

import { useCallback, useState } from 'react';

import { createTicket } from '@/lib/admin-api';

export type TicketStatus = 'idle' | 'creating' | 'created' | 'failed';

interface UseCreateTicketInput {
  projectKey: string;
  token: string;
  id: string;
}

interface TicketState {
  /** Which project, token and feedback this result belongs to. */
  requestKey: string;
  status: TicketStatus;
  url: string;
  errorMessage: string;
}

export interface UseCreateTicketResult {
  status: TicketStatus;
  url: string;
  errorMessage: string;
  create: () => Promise<void>;
}

export function useCreateTicket({ projectKey, token, id }: UseCreateTicketInput): UseCreateTicketResult {
  const requestKey = JSON.stringify([projectKey, token, id]);
  const [state, setState] = useState<TicketState | null>(null);

  const create = useCallback(async () => {
    setState({ requestKey, status: 'creating', url: '', errorMessage: '' });
    const result = await createTicket({ projectKey, token, id });
    if (result.ok) {
      setState({ requestKey, status: 'created', url: result.data.ticket.url, errorMessage: '' });
      return;
    }
    setState({ requestKey, status: 'failed', url: '', errorMessage: result.message });
  }, [projectKey, token, id, requestKey]);

  // A result for another feedback, project or token is not shown here.
  const current = state?.requestKey === requestKey ? state : null;
  return {
    status: current?.status ?? 'idle',
    url: current?.url ?? '',
    errorMessage: current?.errorMessage ?? '',
    create,
  };
}
