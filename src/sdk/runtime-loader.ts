// Loads the capture runtime (src/sdk/capture-runtime.ts) from the app that served sdk.js. The runtime's
// file name carries a hash of its content and is written into sdk.js when both are built
// (scripts/build-sdk.mjs), so an sdk.js always asks for the runtime it was built with.
export type CaptureRuntime = typeof import('@/sdk/capture-runtime');

declare const __LATTICE_CAPTURE_RUNTIME_PATH__: string;
declare const __LATTICE_DEPLOYMENT_ID__: string | null;

export interface CaptureRuntimeSource {
  readonly appOrigin: string;
  /** Path of the runtime file on the app, as the build wrote it into sdk.js. */
  readonly path: string;
  /** The Vercel deployment that built sdk.js and the runtime, or null when they were built elsewhere. */
  readonly deploymentId: string | null;
}

/**
 * The address a load asks. A later deploy replaces the runtime file, so a page that loaded sdk.js before
 * it asks for a file the app no longer serves: `dpl` has Vercel answer from the deployment that built
 * this sdk.js (Skew Protection). A retry asks under a changed query string, because a browser remembers a
 * module that failed to load by its URL and would fail the same URL again without asking the server.
 */
export function getCaptureRuntimeUrl(source: CaptureRuntimeSource, failedLoads: number): string {
  const url = new URL(source.path, source.appOrigin);
  if (source.deploymentId !== null) url.searchParams.set('dpl', source.deploymentId);
  if (failedLoads > 0) url.searchParams.set('retry', String(failedLoads));
  return url.href;
}

/**
 * The returned function loads the runtime once and shares the result. A failed load is not kept, so the
 * next call tries again.
 */
export function createRuntimeLoader(appOrigin: string): () => Promise<CaptureRuntime> {
  let loading: Promise<CaptureRuntime> | null = null;
  let failedLoads = 0;
  return () => {
    if (loading) {
      return loading;
    }
    const source = { appOrigin, path: __LATTICE_CAPTURE_RUNTIME_PATH__, deploymentId: __LATTICE_DEPLOYMENT_ID__ };
    const load: Promise<CaptureRuntime> = import(getCaptureRuntimeUrl(source, failedLoads));
    loading = load;
    load.catch(() => {
      failedLoads += 1;
      loading = null;
    });
    return load;
  };
}
