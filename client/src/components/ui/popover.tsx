'use client';

import { DropdownMenu as RMenu, Popover as RPopover, Tooltip as RTooltip } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from './cn';

/** Popover, Menu and Tooltip, on Radix, in the canvas's menu style (white, 14px radius, the pop shadow). */

export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  align = 'start',
  className,
  width,
}: {
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
  className?: string;
  width?: number | string;
}) {
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content sideOffset={6} align={align} className={cn('popover', className)} style={{ width }}>
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

export type MenuItem =
  | { label: ReactNode; onSelect: () => void; icon?: ReactNode; danger?: boolean; disabled?: boolean; end?: ReactNode }
  | 'separator';

/** A menu of actions behind a button (the "more" button on a card). */
export function Menu({
  trigger,
  items,
  align = 'end',
  label,
}: {
  trigger: ReactNode;
  items: MenuItem[];
  align?: 'start' | 'end';
  label?: string;
}) {
  return (
    <RMenu.Root>
      <RMenu.Trigger asChild aria-label={label}>
        {trigger}
      </RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content className="menu is-floating" align={align} sideOffset={6} style={{ minWidth: 200 }}>
          {items.map((item, i) =>
            item === 'separator' ? (
              <RMenu.Separator key={i} className="menu-sep" />
            ) : (
              <RMenu.Item
                key={i}
                className={cn('opt', item.danger && 'is-danger')}
                disabled={item.disabled}
                onSelect={item.onSelect}
              >
                {item.icon}
                {item.label}
                {item.end !== undefined && <span className="end">{item.end}</span>}
              </RMenu.Item>
            ),
          )}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}

/** A short hint on hover or focus. Wrap the app (or a page) in TooltipProvider once. */
export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6} className="tip">
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RTooltip.Provider delayDuration={250}>{children}</RTooltip.Provider>;
}
