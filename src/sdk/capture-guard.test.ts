import { expect, it, vi } from 'vitest';
import { CapturePageChangedError, CapturePageNotAllowedError, serializeAfterWait } from '@/sdk/capture-guard';

function createPage(overrides: { isAllowed?: () => boolean; getPathname?: () => string } = {}) {
  return { startPathname: '/orders', getPathname: () => '/orders', isAllowed: () => true, ...overrides };
}

it('serializes the page once the wait is over and the page is still the allowed one', async () => {
  const serialize = vi.fn(() => 'screen');
  await expect(serializeAfterWait(Promise.resolve(), createPage(), serialize)).resolves.toBe('screen');
  expect(serialize).toHaveBeenCalledOnce();
});

it('never serializes a page the policy leaves out, even one navigated to during the wait', async () => {
  let pathname = '/orders';
  let release: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const serialize = vi.fn(() => 'screen');
  const result = serializeAfterWait(wait, createPage({ getPathname: () => pathname, isAllowed: () => pathname === '/orders' }), serialize);

  pathname = '/admin';
  release();

  await expect(result).rejects.toBeInstanceOf(CapturePageNotAllowedError);
  expect(serialize).not.toHaveBeenCalled();
});

it('does not save another allowed page in place of the one the reporter asked to save', async () => {
  let pathname = '/orders';
  const serialize = vi.fn(() => 'screen');
  const result = serializeAfterWait(Promise.resolve(), createPage({ getPathname: () => pathname }), serialize);

  pathname = '/invoices';

  await expect(result).rejects.toBeInstanceOf(CapturePageChangedError);
  expect(serialize).not.toHaveBeenCalled();
});
