// Reads which image file the browser is showing for a captured <img>. Elements inside an excluded
// region are never read: rrweb keeps them in its mirror, so their real source must not leak back.
type LiveImage = Pick<HTMLImageElement, 'currentSrc' | 'closest'>;

function isLiveImage(element: unknown): element is LiveImage {
  return typeof element === 'object' && element !== null && 'currentSrc' in element && 'closest' in element;
}

export function findLiveImageSource(element: unknown, excludedSelector: string): string | null {
  if (!isLiveImage(element) || element.closest(excludedSelector) || !element.currentSrc) {
    return null;
  }
  return element.currentSrc;
}
