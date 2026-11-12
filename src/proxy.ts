import { NextResponse, type NextRequest } from 'next/server';

import { getWidgetFrameAncestorsPolicy } from '@/lib/http/widget-frame-policy';

export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const projectKey = request.nextUrl.searchParams.get('projectKey');
  response.headers.set('Content-Security-Policy', getWidgetFrameAncestorsPolicy(projectKey));
  return response;
}

export const config = {
  matcher: '/widget',
};
