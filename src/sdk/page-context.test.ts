import { describe, expect, it } from 'vitest';
import { getPageUrl } from '@/sdk/page-context';

describe('getPageUrl', () => {
  it('drops the query string and hash', () => {
    expect(getPageUrl('https://demo.example.com/orders/42?token=secret&tab=2#details')).toBe(
      'https://demo.example.com/orders/42',
    );
  });

  it('keeps a non-default port and the root path', () => {
    expect(getPageUrl('http://localhost:4000/?q=1')).toBe('http://localhost:4000/');
  });
});
