/** A keyboard key in a shortcut hint. */
export function ShortcutKey({ children }: { children: string }) {
  return <kbd className="rounded border border-(--admin-border) bg-(--admin-surface) px-1.5 py-0.5 font-mono text-xs">{children}</kbd>;
}
