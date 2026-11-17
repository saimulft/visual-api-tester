'use client';

import type { ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui';
import type { Me } from '@/contracts/auth';
import { CheckBanner } from './check-banner';
import { CommandPalette } from './command-palette';
import { Rail } from './rail';
import { ShellProvider } from './shell-context';

/**
 * The signed-in frame: the rail, then the main column with the email-check banner and the page. Pages
 * render a Topbar, then a PageFrame (or their own layout, like the workspace). `detail` hides the phone tab
 * bar on detail screens.
 */
export function AppShell({ user, children }: { user: Me; children: ReactNode }) {
  return (
    <ShellProvider user={user}>
      <TooltipProvider>
        <div className="app">
          <Rail />
          <div className="main">
            <CheckBanner />
            {children}
          </div>
        </div>
        <CommandPalette />
      </TooltipProvider>
    </ShellProvider>
  );
}
