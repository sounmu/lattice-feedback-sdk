import { expect, it } from 'vitest';
import { findLiveImageSource } from '@/sdk/live-image-source';

const EXCLUDED = '[data-lattice-block]';

function createImage(isExcluded: boolean, currentSrc = 'https://host.example.com/large.png') {
  return { currentSrc, closest: () => (isExcluded ? {} : null) };
}

it('reports the shown file, but never for an excluded image', () => {
  expect(findLiveImageSource(createImage(false), EXCLUDED)).toBe('https://host.example.com/large.png');
  expect(findLiveImageSource(createImage(true), EXCLUDED)).toBeNull();
  expect(findLiveImageSource(createImage(false, ''), EXCLUDED)).toBeNull();
  expect(findLiveImageSource(null, EXCLUDED)).toBeNull();
});
