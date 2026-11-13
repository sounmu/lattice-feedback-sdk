import { describe, expect, it } from 'vitest';

import { findAdminLoadStatus } from '@/lib/admin-load-status';

describe('findAdminLoadStatus', () => {
  it('asks for a token when none is saved', () => {
    expect(findAdminLoadStatus('', null)).toBe('unauthenticated');
  });

  it('is loading until the first response arrives', () => {
    expect(findAdminLoadStatus('secret', null)).toBe('loading');
  });

  it('is ready once data has loaded', () => {
    expect(findAdminLoadStatus('secret', { hasData: true, errorStatus: null })).toBe('ready');
  });

  it('keeps showing loaded data when a refresh fails', () => {
    expect(findAdminLoadStatus('secret', { hasData: true, errorStatus: 503 })).toBe('ready');
  });

  it('shows an error when nothing ever loaded', () => {
    expect(findAdminLoadStatus('secret', { hasData: false, errorStatus: 503 })).toBe('error');
  });

  it('asks for the token again when the server rejects it', () => {
    expect(findAdminLoadStatus('wrong', { hasData: false, errorStatus: 401 })).toBe('unauthorized');
  });

  it('asks for the token again even if data loaded earlier', () => {
    expect(findAdminLoadStatus('revoked', { hasData: true, errorStatus: 401 })).toBe('unauthorized');
  });
});
