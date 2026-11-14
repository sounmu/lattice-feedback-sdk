import { FeedbackSdk } from '@/sdk/feedback-sdk';
import { resolveCapturePolicyFromJson } from '@/lib/capture-policy';
import { findOriginFromScriptSource, findSdkScriptElement } from '@/sdk/script-origin';
import type { LatticeFeedbackApi } from '@/sdk/types';

declare global {
  interface Window {
    LatticeFeedback?: LatticeFeedbackApi;
  }
}

// document.currentScript is only set while this module body runs synchronously.
const currentScript = document.currentScript;

function bootstrap(): void {
  if (window.LatticeFeedback) {
    console.warn('[LatticeFeedback] SDK script loaded more than once; keeping the first instance.');
    return;
  }
  const scriptElement = findSdkScriptElement(currentScript);
  const appOrigin = scriptElement ? findOriginFromScriptSource(scriptElement.src) : null;
  if (!scriptElement || !appOrigin) {
    console.warn('[LatticeFeedback] Could not determine the SDK origin from the script src; widget disabled.');
    return;
  }

  const sdk = new FeedbackSdk(appOrigin);
  const api: LatticeFeedbackApi = {
    init: (options) => sdk.init(options),
    setUser: (reporter) => sdk.setUser(reporter),
    open: () => sdk.open(),
    close: () => sdk.close(),
    destroy: () => {
      sdk.destroy();
      if (window.LatticeFeedback === api) {
        delete window.LatticeFeedback;
      }
    },
  };
  window.LatticeFeedback = api;

  const projectKey = scriptElement.dataset.projectKey;
  if (projectKey) {
    const capturePolicy = resolveCapturePolicyFromJson(scriptElement.dataset.capturePolicy);
    sdk.init({ projectKey, capturePolicy: capturePolicy ?? undefined });
  }
}

bootstrap();
