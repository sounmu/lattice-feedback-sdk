import { expect, it } from 'vitest';
import { getTranslucentColor, SDK_THEME } from '@/sdk/theme-tokens';

it('writes a #rrggbb token as rgba at the given opacity', () => {
  expect(getTranslucentColor('#c9303a', 0.85)).toBe('rgba(201, 48, 58, 0.85)');
  expect(getTranslucentColor('#0074E2', 0.12)).toBe('rgba(0, 116, 226, 0.12)');
  expect(getTranslucentColor(SDK_THEME.surface, 1)).toBe('rgba(255, 255, 255, 1)');
});
