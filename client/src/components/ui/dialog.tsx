'use client';

import { X } from 'lucide-react';
import { Dialog as RDialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from './cn';

/** A modal dialog: title, a line under it, the body and the actions at the foot. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
  trigger,
  size = 'md',
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  trigger?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RDialog.Trigger asChild>{trigger}</RDialog.Trigger>}
      <RDialog.Portal>
        <RDialog.Overlay className="dialog-veil" />
        <RDialog.Content className={cn('dialog', `is-${size}`)} aria-describedby={description ? undefined : undefined}>
          <div className="dialog-head">
            <div className="grow">
              <RDialog.Title className="dialog-title">{title}</RDialog.Title>
              {description ? (
                <RDialog.Description className="dialog-sub">{description}</RDialog.Description>
              ) : (
                <RDialog.Description className="sr">{title}</RDialog.Description>
              )}
            </div>
            <RDialog.Close className="btn btn-sm btn-icon btn-ghost" aria-label="Close">
              <X className="i" aria-hidden="true" />
            </RDialog.Close>
          </div>
          {children && <div className="dialog-body">{children}</div>}
          {actions && <div className="dialog-foot">{actions}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export const DialogClose = RDialog.Close;
