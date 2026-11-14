import type { ReactNode } from 'react';

import { BackIcon, CloseIcon, InfoIcon } from '@/components/widget/WidgetIcons';

export const PRIMARY_BUTTON_CLASS =
  'min-h-11 rounded-[10px] bg-fw-primary px-4 font-semibold text-white hover:bg-fw-primary-hover disabled:opacity-50';
export const SECONDARY_BUTTON_CLASS =
  'min-h-11 rounded-[10px] border border-fw-border bg-fw-surface px-4 font-semibold text-fw-text hover:bg-fw-surface-sub disabled:opacity-50';
export const DANGER_BUTTON_CLASS =
  'min-h-11 rounded-[10px] bg-fw-danger px-4 font-semibold text-white hover:opacity-90 disabled:opacity-50';
const ICON_BUTTON_CLASS =
  'flex size-11 shrink-0 items-center justify-center rounded-[10px] text-fw-sub hover:bg-fw-surface-sub';

interface WidgetHeaderProps {
  title: string;
  subtitle: string;
  onClose?: () => void;
  /** Replaces the avatar with a back button. */
  onBack?: () => void;
}

export function WidgetHeader({ title, subtitle, onClose, onBack }: WidgetHeaderProps) {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-fw-border bg-fw-surface px-3 py-2">
      {onBack ? (
        <button type="button" aria-label="뒤로" className={ICON_BUTTON_CLASS} onClick={onBack}>
          <BackIcon />
        </button>
      ) : (
        <span aria-hidden="true" className="ml-1 flex size-9 shrink-0 items-center justify-center rounded-full bg-fw-primary font-bold text-white">
          L
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-bold">{title}</h1>
        <p className="truncate text-xs text-fw-sub">{subtitle}</p>
      </div>
      {onClose ? (
        <button type="button" aria-label="닫기" className={ICON_BUTTON_CLASS} onClick={onClose}>
          <CloseIcon />
        </button>
      ) : null}
    </header>
  );
}

/** The scrolling middle part. Only this part scrolls, so the composer below always stays in view. */
export function WidgetBody({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-fw-surface-sub p-4">{children}</div>;
}

export function WidgetFooter({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 flex-col gap-2 border-t border-fw-border bg-fw-surface p-3">{children}</div>;
}

export type BannerTone = 'info' | 'warning' | 'danger' | 'success';

const BANNER_TONE_CLASSES: Record<BannerTone, string> = {
  info: 'bg-fw-primary-weak text-fw-text',
  warning: 'bg-fw-warning-weak text-fw-warning',
  danger: 'bg-fw-danger-weak text-fw-danger',
  success: 'bg-fw-success-weak text-fw-text',
};

interface WidgetBannerProps {
  tone: BannerTone;
  title?: string;
  children?: ReactNode;
  /** Errors are announced right away; everything else politely. */
  isAlert?: boolean;
  icon?: ReactNode;
}

export function WidgetBanner({ tone, title, children, isAlert = false, icon }: WidgetBannerProps) {
  const liveProps = isAlert ? { role: 'alert' } : { role: 'status', 'aria-live': 'polite' as const };
  return (
    <div {...liveProps} className={`flex gap-2 rounded-xl p-3 ${BANNER_TONE_CLASSES[tone]}`}>
      <span className="mt-0.5 shrink-0">{icon ?? <InfoIcon className="size-4" />}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-[13px]">{children}</div> : null}
      </div>
    </div>
  );
}

interface AttachmentCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  removeLabel: string;
  disabled: boolean;
  onRemove: () => void;
  /** Extra actions shown before the remove button, such as a preview toggle. */
  actions?: ReactNode;
}

export function AttachmentCard({ icon, title, description, removeLabel, disabled, onRemove, actions }: AttachmentCardProps) {
  return (
    <li className="flex items-center gap-2 rounded-xl border border-fw-border bg-fw-surface p-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-fw-primary-weak text-fw-primary">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{title}</p>
        <p className="truncate text-xs text-fw-muted">{description}</p>
      </div>
      {actions}
      <button
        type="button"
        aria-label={removeLabel}
        className="flex size-9 shrink-0 items-center justify-center rounded-[10px] text-fw-muted hover:bg-fw-surface-sub disabled:opacity-50"
        disabled={disabled}
        onClick={onRemove}
      >
        <CloseIcon className="size-4" />
      </button>
    </li>
  );
}
