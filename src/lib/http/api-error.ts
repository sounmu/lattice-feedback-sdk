import { NextResponse } from 'next/server';
import type { ApiErrorResponse } from '@/types/feedback';

export function createApiErrorResponse(status: number, code: string, message: string): NextResponse<ApiErrorResponse> {
  return NextResponse.json({ error: { code, message } }, { status });
}
