'use client';

import { Bell, Gauge, Sparkles, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Settings' four tabs as the canvas's .subnav: Account, AI and keys, Alerts, Usage. */
const TABS = [
  { href: '/settings/account', label: 'Account', icon: User },
  { href: '/settings/ai', label: 'AI and keys', icon: Sparkles },
  { href: '/settings/alerts', label: 'Alerts', icon: Bell },
  { href: '/settings/usage', label: 'Usage', icon: Gauge },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="subnav" aria-label="Settings sections">
      {TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} aria-current={pathname === tab.href ? 'page' : undefined}>
          <tab.icon className="i" aria-hidden="true" />
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/** "2 h ago", "3 days ago", "just now". */
export function ago(at: number | null, now = Date.now()): string {
  if (!at) return 'never';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
