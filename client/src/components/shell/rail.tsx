'use client';

import { CalendarClock, Database, LayoutGrid, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/ui';
import { useShell } from './shell-context';

/** The rail: logo, the four places and the avatar. On phone it becomes the bottom tab bar. */
export const NAV = [
  { href: '/projects', label: 'Projects', icon: LayoutGrid },
  { href: '/data', label: 'Data', icon: Database },
  { href: '/schedules', label: 'Schedules', icon: CalendarClock },
  { href: '/settings/account', label: 'Settings', icon: Settings, match: '/settings' },
] as const;

export function isCurrent(pathname: string, item: (typeof NAV)[number]) {
  const base = 'match' in item ? item.match : item.href;
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function Rail() {
  const pathname = usePathname();
  const { user } = useShell();
  return (
    <nav className="rail" aria-label="Main">
      <Logo href="/projects" word={false} label="Dialed, all projects" />
      {NAV.map((item) => (
        <Link
          key={item.href}
          className="rail-link"
          href={item.href}
          aria-current={isCurrent(pathname, item) ? 'page' : undefined}
        >
          <item.icon className="i" aria-hidden="true" />
          <span>{item.label}</span>
        </Link>
      ))}
      <span className="rail-gap" />
      <Link className="avatar" href="/settings/account" aria-label={`Account: ${user.name || user.email}`}>
        {user.initials}
      </Link>
    </nav>
  );
}
