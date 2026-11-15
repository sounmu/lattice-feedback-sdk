export class CapturePageNotAllowedError extends Error {
  constructor() {
    super('The page is not allowed by the capture policy.');
    this.name = 'CapturePageNotAllowedError';
  }
}

export class CapturePageChangedError extends Error {
  constructor() {
    super('The page changed while the capture was being prepared.');
    this.name = 'CapturePageChangedError';
  }
}

export interface CapturePageState {
  readonly startPathname: string;
  readonly getPathname: () => string;
  readonly isAllowed: () => boolean;
}

/**
 * The document is serialized right after the wait and nothing else is awaited in between, so the policy
 * is checked against the page that is actually serialized. A page that changed during the wait is not
 * the screen the reporter asked to save.
 */
export async function serializeAfterWait<T>(wait: Promise<unknown>, page: CapturePageState, serialize: () => T): Promise<T> {
  await wait;
  if (!page.isAllowed()) throw new CapturePageNotAllowedError();
  if (page.getPathname() !== page.startPathname) throw new CapturePageChangedError();
  return serialize();
}
