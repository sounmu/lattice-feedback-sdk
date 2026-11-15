'use client';

import type { ReactNode } from 'react';
import { InternationalizationProvider } from '@astryxdesign/core/i18n';
import koreanMessages from '@astryxdesign/core/locales/ko-KR.generated.js';
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';

const WIDGET_LOCALE = 'ko-KR';
// Names Astryx gives its own controls, such as the tab bar or a loading spinner, read in Korean.
const WIDGET_MESSAGES = { [WIDGET_LOCALE]: koreanMessages };

// The widget always renders light: it floats over a host page whose colours it cannot know, and the
// host-page SDK UI (launcher, pins, status bar) is painted with the same light token values.
export function WidgetTheme({ children }: { children: ReactNode }) {
  return (
    <InternationalizationProvider locale={WIDGET_LOCALE} messages={WIDGET_MESSAGES}>
      <Theme theme={neutralTheme} mode="light">
        {children}
      </Theme>
    </InternationalizationProvider>
  );
}
