'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Kbd, Logo } from '@/components/ui';
import { useShell } from './shell-context';

/**
 * A page's top: on desktop the topbar (workspace and title, the ⌘K search, the page's main action); on
 * phone the header (logo, title, the action as an icon button, the avatar). Every page under (app) renders
 * one first.
 */
export function Topbar({
  title,
  crumbs,
  action,
  phoneAction,
  search = true,
}: {
  title: string;
  /** Above the title; defaults to "<Workspace> workspace". */
  crumbs?: ReactNode;
  /** The page's main action (a primary button). */
  action?: ReactNode;
  /** The same action as an icon button for the phone header. */
  phoneAction?: ReactNode;
  search?: boolean;
}) {
  const { user, setPaletteOpen } = useShell();
  return (
    <>
      <header className="topbar">
        <div className="topbar-title">
          <span className="crumbs">{crumbs ?? `${user.workspace} workspace`}</span>
          <h1>{title}</h1>
        </div>
        {search && (
          <button
            className="search"
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search projects and data"
            aria-keyshortcuts="Meta+K Control+K"
          >
            <Search className="i i-sm" aria-hidden="true" />
            <span className="ph">Search projects and data</span>
            <Kbd>⌘K</Kbd>
          </button>
        )}
        {action}
      </header>
      <header className="mhead">
        <Logo href="/projects" word={false} />
        <div className="mhead-title">{title}</div>
        {phoneAction}
        <Link className="avatar" href="/settings/account" aria-label={`Account: ${user.name || user.email}`}>
          {user.initials}
        </Link>
      </header>
    </>
  );
}
