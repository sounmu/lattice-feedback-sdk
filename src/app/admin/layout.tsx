import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { WidgetTheme } from '@/components/widget/WidgetTheme';

import '@/app/widget/widget.css';
import '@/app/admin/admin-theme.css';

export const metadata: Metadata = {
  title: 'Lattice 피드백 관리',
};

// The console and the saved-screen page are drawn with the widget's theme and controls, so an admin
// sees the same buttons, marks and replay the reporter saw.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <WidgetTheme>{children}</WidgetTheme>;
}
