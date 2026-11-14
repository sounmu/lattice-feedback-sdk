import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './admin-theme.css';

export const metadata: Metadata = {
  title: 'Lattice 피드백 관리',
};

export default function AdminConsoleLayout({ children }: { children: ReactNode }) {
  return children;
}
