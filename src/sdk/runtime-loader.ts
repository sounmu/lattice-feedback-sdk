// Loads the capture runtime (src/sdk/capture-runtime.ts) from the app that served sdk.js. The runtime's
// file name carries a hash of its content and is written into sdk.js when both are built
// (scripts/build-sdk.mjs), so an sdk.js always asks for the runtime it was built with.
export type CaptureRuntime = typeof import('@/sdk/capture-runtime');

declare const __LATTICE_CAPTURE_RUNTIME_PATH__: string;

/**
 * The returned function loads the runtime once and shares the result. A failed load is not kept, so the
 * next call tries again. It asks under a changed query string, because a browser remembers a module that
 * failed to load by its URL and would fail the same URL again without asking the server.
 */
export function createRuntimeLoader(appOrigin: string): () => Promise<CaptureRuntime> {
  let loading: Promise<CaptureRuntime> | null = null;
  let failedLoads = 0;
  return () => {
    if (loading) {
      return loading;
    }
    const query = failedLoads === 0 ? '' : `?retry=${failedLoads}`;
    const load: Promise<CaptureRuntime> = import(`${appOrigin}${__LATTICE_CAPTURE_RUNTIME_PATH__}${query}`);
    loading = load;
    load.catch(() => {
      failedLoads += 1;
      loading = null;
    });
    return load;
  };
}
