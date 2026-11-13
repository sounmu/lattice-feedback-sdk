import { expect, it } from 'vitest';
import { findLiveImageSource } from '@/sdk/live-image-source';

const EXCLUDED = '[data-lattice-block]';

function createImage(isExcluded: boolean, currentSrc = 'https://host.example.com/large.png') {
  return { currentSrc, naturalWidth: 100, naturalHeight: 50, closest: () => (isExcluded ? {} : null) };
}

it('reports the shown file and its density-corrected size, but never for an excluded image', () => {
  expect(findLiveImageSource(createImage(false), EXCLUDED)).toEqual({
    url: 'https://host.example.com/large.png',
    width: 100,
    height: 50,
  });
  expect(findLiveImageSource(createImage(true), EXCLUDED)).toBeNull();
  expect(findLiveImageSource(createImage(false, ''), EXCLUDED)).toBeNull();
  expect(findLiveImageSource(null, EXCLUDED)).toBeNull();
});
