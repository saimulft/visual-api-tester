'use client';

import { Toaster as Sonner, toast } from 'sonner';

/** Toasts (sonner), styled like the canvas's dark Ready banner. Call toast('Saved') from anywhere. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      gap={8}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: 'toast',
          title: 'toast-title',
          description: 'toast-sub',
          actionButton: 'btn btn-sm btn-primary',
          cancelButton: 'btn btn-sm btn-ghost',
          success: 'is-ok',
          error: 'is-err',
          icon: 'toast-ico',
        },
      }}
    />
  );
}

export { toast };
