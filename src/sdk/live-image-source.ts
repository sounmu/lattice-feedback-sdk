// Reads which image file the browser is showing for a captured <img>. Elements inside an excluded
// region are never read: rrweb keeps them in its mirror, so their real source must not leak back.
export interface LiveImageSource {
  url: string;
  /** Density-corrected intrinsic size in CSS pixels, so a 2x file still lays out at its original size. */
  width: number;
  height: number;
}

type LiveImage = Pick<HTMLImageElement, 'currentSrc' | 'naturalWidth' | 'naturalHeight' | 'closest'>;

function isLiveImage(element: unknown): element is LiveImage {
  return typeof element === 'object' && element !== null && 'currentSrc' in element && 'closest' in element;
}

export function findLiveImageSource(element: unknown, excludedSelector: string): LiveImageSource | null {
  if (!isLiveImage(element) || element.closest(excludedSelector) || !element.currentSrc) {
    return null;
  }
  return { url: element.currentSrc, width: element.naturalWidth, height: element.naturalHeight };
}
