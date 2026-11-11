const SDK_SCRIPT_PATH_SUFFIX = '/sdk.js';

export function findOriginFromScriptSource(source: string): string | null {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  return url.origin;
}

export function isSdkScriptSource(source: string): boolean {
  try {
    return new URL(source).pathname.endsWith(SDK_SCRIPT_PATH_SUFFIX);
  } catch {
    return false;
  }
}

export function findSdkScriptElement(currentScript: HTMLOrSVGScriptElement | null): HTMLScriptElement | null {
  if (currentScript instanceof HTMLScriptElement && currentScript.src !== '') {
    return currentScript;
  }
  const scripts = document.querySelectorAll<HTMLScriptElement>('script[src]');
  for (let index = scripts.length - 1; index >= 0; index -= 1) {
    if (isSdkScriptSource(scripts[index].src)) {
      return scripts[index];
    }
  }
  return null;
}
