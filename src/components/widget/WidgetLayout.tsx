'use client';

import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Banner } from '@astryxdesign/core/Banner';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

import type { IconProps } from '@/components/widget/WidgetIcons';

/** Whose avatar the widget shows: the team that answers the feedback. */
export const WIDGET_TEAM_NAME = 'Lattice';

const CLOSE_LABEL = '닫기';
const BACK_LABEL = '뒤로';

// Where a header is drawn when the panel has tabs: above them. The tabs stay mounted while the views
// under them change, so a header rendered in place could only sit below the tabs.
const WidgetHeaderSlotContext = createContext<HTMLElement | null>(null);

export const WidgetHeaderSlotProvider = WidgetHeaderSlotContext.Provider;

interface WidgetHeaderProps {
  title: string;
  subtitle: string;
  onClose?: () => void;
  /** Replaces the avatar with a back button. */
  onBack?: () => void;
  /** Where the back button leads, when "back" alone would not say. */
  backLabel?: string;
}

export function WidgetHeader({ title, subtitle, onClose, onBack, backLabel = BACK_LABEL }: WidgetHeaderProps) {
  const slot = useContext(WidgetHeaderSlotContext);
  const header = (
    <HStack as="header" gap={3} align="center" paddingInlineStart={onBack ? 3 : 4} paddingInlineEnd={3} paddingBlock={1.5} className="shrink-0">
      {onBack ? (
        <IconButton label={backLabel} tooltip={backLabel} icon={<Icon icon="chevronLeft" />} variant="ghost" size="lg" onClick={onBack} />
      ) : (
        <Avatar name={WIDGET_TEAM_NAME} size={32} shape="rounded" tooltip={false} />
      )}
      <VStack gap={0} className="min-w-0 flex-1">
        <Heading level={3} accessibilityLevel={1} maxLines={1}>
          {title}
        </Heading>
        <Text as="p" type="supporting" maxLines={2}>
          {subtitle}
        </Text>
      </VStack>
      {onClose ? (
        <IconButton label={CLOSE_LABEL} tooltip={CLOSE_LABEL} icon={<Icon icon="close" />} variant="ghost" size="lg" onClick={onClose} />
      ) : null}
    </HStack>
  );
  return slot ? createPortal(header, slot) : header;
}

/** The scrolling middle part. Only this part scrolls, so the composer below always stays in view. */
export function WidgetBody({ children }: { children: ReactNode }) {
  return (
    <VStack gap={3} padding={4} isScrollable className="min-h-0 flex-1">
      {children}
    </VStack>
  );
}

export function WidgetFooter({ children }: { children: ReactNode }) {
  return (
    <VStack gap={2} padding={3} className="shrink-0 border-t border-(--color-border)">
      {children}
    </VStack>
  );
}

/** A message field and its send button on one borderless surface, the way a messenger draws its input. */
export function WidgetComposer({ children }: { children: ReactNode }) {
  return <div className="widget-composer">{children}</div>;
}

export type BannerTone = 'info' | 'warning' | 'danger' | 'success';

const BANNER_STATUSES: Record<BannerTone, 'info' | 'warning' | 'error' | 'success'> = {
  info: 'info',
  warning: 'warning',
  danger: 'error',
  success: 'success',
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
  // A banner always has a title. One that only carries a message shows the message there.
  return (
    <div {...liveProps}>
      <Banner status={BANNER_STATUSES[tone]} title={title ?? children} description={title ? children : undefined} icon={icon} />
    </div>
  );
}

interface AttachmentCardProps {
  /** Which kind of attachment the card holds, so the newest card of a kind can be scrolled into view. */
  kind: 'comment' | 'edit' | 'flow' | 'screen';
  icon: ComponentType<IconProps>;
  title: string;
  description: string;
  removeLabel: string;
  disabled: boolean;
  onRemove: () => void;
  /** Extra actions shown before the remove button, such as a preview toggle. */
  actions?: ReactNode;
}

export function AttachmentCard({ kind, icon, title, description, removeLabel, disabled, onRemove, actions }: AttachmentCardProps) {
  return (
    <li data-kind={kind}>
      <Card padding={2}>
        <HStack gap={2} align="center">
          <span className="flex size-9 shrink-0 items-center justify-center">
            <Icon icon={icon} color="secondary" />
          </span>
          <VStack gap={0} className="min-w-0 flex-1">
            <Text as="p" type="label" maxLines={1}>
              {title}
            </Text>
            <Text as="p" type="supporting" maxLines={1}>
              {description}
            </Text>
          </VStack>
          {actions}
          <IconButton
            label={removeLabel}
            tooltip={removeLabel}
            icon={<Icon icon="close" />}
            variant="ghost"
            size="lg"
            isDisabled={disabled}
            onClick={onRemove}
          />
        </HStack>
      </Card>
    </li>
  );
}
