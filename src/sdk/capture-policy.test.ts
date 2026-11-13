import { afterEach, describe, expect, it, vi } from 'vitest';
import { findCapturePolicy } from '@/lib/capture-policy';
import { isCapturePageAllowed } from '@/sdk/capture-policy';

afterEach(() => vi.unstubAllGlobals());

describe('capture policy boundary', () => {
  it('allows only the explicitly configured pathname', () => {
    const policy = findCapturePolicy({
      allowedPaths: ['/contracts'],
      targets: [{ id: 'register-contract', selector: 'main button' }],
    });
    vi.stubGlobal('window', { location: { pathname: '/contracts' } });
    expect(isCapturePageAllowed(policy)).toBe(true);

    vi.stubGlobal('window', { location: { pathname: '/contracts/private' } });
    expect(isCapturePageAllowed(policy)).toBe(false);
  });

  it.each([
    undefined,
    {},
    { allowedPaths: ['https://host.example/'], targets: [] },
    { allowedPaths: ['/contracts?token=secret'], targets: [] },
    { allowedPaths: ['/contracts#private'], targets: [] },
    { allowedPaths: ['/'], targets: [{ id: 'valid', selector: '' }] },
    { allowedPaths: ['/'], targets: [{ id: 'customer@example.com', selector: 'button' }] },
    { allowedPaths: ['/'], targets: [{ id: 'same', selector: 'button' }, { id: 'same', selector: 'input' }] },
    { allowedPaths: Array.from({ length: 21 }, () => '/'), targets: [] },
    { allowedPaths: ['/'], targets: Array.from({ length: 51 }, (_, index) => ({ id: `target-${index}`, selector: 'button' })) },
  ])('rejects missing, sensitive, ambiguous, or oversized configuration: %j', (value) => {
    expect(findCapturePolicy(value)).toBeNull();
  });

  it('copies configuration so caller mutation cannot broaden captured pages', () => {
    const input = { allowedPaths: ['/contracts'], targets: [{ id: 'register', selector: 'button' }] };
    const policy = findCapturePolicy(input);
    input.allowedPaths.push('/private');
    input.targets[0].selector = '*';
    vi.stubGlobal('window', { location: { pathname: '/private' } });

    expect(isCapturePageAllowed(policy)).toBe(false);
    expect(policy?.targets[0].selector).toBe('button');
  });
});
