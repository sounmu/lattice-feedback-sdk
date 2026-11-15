import type { ReactNode } from 'react';

import { WidgetTheme } from '@/components/widget/WidgetTheme';

import './widget.css';

export default function WidgetLayout({ children }: { children: ReactNode }) {
  return <WidgetTheme>{children}</WidgetTheme>;
}
