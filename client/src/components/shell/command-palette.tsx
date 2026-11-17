'use client';

import { Command } from 'cmdk';
import { CalendarClock, Database, FolderPlus, LayoutGrid, Search, Settings } from 'lucide-react';
import { Dialog as RDialog } from 'radix-ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Monogram } from '@/components/ui';
import { api } from '@/components/auth/api';
import { useShell } from './shell-context';

type Item = { id: string; label: string; hint?: string; href: string; monogram?: string };

const PAGES: (Item & { icon: typeof LayoutGrid })[] = [
  { id: 'p-projects', label: 'Projects', href: '/projects', icon: LayoutGrid },
  { id: 'p-new', label: 'New project', href: '/projects/new', icon: FolderPlus },
  { id: 'p-data', label: 'Saved data', href: '/data', icon: Database },
  { id: 'p-schedules', label: 'Schedules', href: '/schedules', icon: CalendarClock },
  { id: 'p-settings', label: 'Settings', href: '/settings/account', icon: Settings },
  { id: 'p-ai', label: 'Your AI and keys', href: '/settings/ai', icon: Settings },
];

/**
 * ⌘K: search projects, datasets and pages, then jump. Lists load when it opens. Datasets come from
 * /api/datasets (chat B) when that's there.
 */
export function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useShell();
  const router = useRouter();
  const [projects, setProjects] = useState<Item[]>([]);
  const [datasets, setDatasets] = useState<Item[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, setPaletteOpen]);

  useEffect(() => {
    if (!paletteOpen) return;
    let live = true;
    void api<{ projects: { id: string; name: string; apiName: string; monogram: string }[] }>('/api/projects').then(
      (r) => {
        if (live && r.ok)
          setProjects(
            r.data.projects.map((p) => ({
              id: p.id,
              label: p.name,
              hint: p.apiName,
              href: `/projects/${p.id}`,
              monogram: p.monogram,
            })),
          );
      },
    );
    void api<{ datasets?: { id: string; name: string; rows?: number }[] }>('/api/datasets').then((r) => {
      if (live && r.ok && Array.isArray(r.data?.datasets))
        setDatasets(
          r.data.datasets.map((d) => ({
            id: d.id,
            label: d.name,
            hint: d.rows !== undefined ? `${d.rows.toLocaleString('en-AU')} rows` : undefined,
            href: `/data?dataset=${d.id}`,
          })),
        );
    });
    return () => {
      live = false;
    };
  }, [paletteOpen]);

  const go = (href: string) => {
    setPaletteOpen(false);
    router.push(href);
  };

  return (
    <RDialog.Root open={paletteOpen} onOpenChange={setPaletteOpen}>
      <RDialog.Portal>
        <RDialog.Overlay className="dialog-veil" />
        <RDialog.Content
          className="dialog cmdk"
          style={{ top: '18%', transform: 'translate(-50%, 0)', animationName: 'popIn' }}
        >
          <RDialog.Title className="sr">Search projects, data and pages</RDialog.Title>
          <RDialog.Description className="sr">Type to search, then press Enter to open.</RDialog.Description>
          <Command label="Search projects, data and pages" loop>
            <label className="input menu-search">
              <Search className="i i-sm" aria-hidden="true" />
              <Command.Input placeholder="Search projects and data" autoFocus />
            </label>
            <Command.List className="cmdk-list">
              <Command.Empty className="menu-empty">Nothing matches. Try a project or dataset name.</Command.Empty>
              {projects.length > 0 && (
                <Command.Group heading="Projects">
                  {projects.map((p) => (
                    <Command.Item
                      key={p.id}
                      value={`project ${p.label} ${p.hint ?? ''} ${p.id}`}
                      onSelect={() => go(p.href)}
                    >
                      <Monogram text={p.monogram ?? ''} size="sm" />
                      {p.label}
                      {p.hint && <span className="end">{p.hint}</span>}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {datasets.length > 0 && (
                <Command.Group heading="Saved data">
                  {datasets.map((d) => (
                    <Command.Item key={d.id} value={`data ${d.label} ${d.id}`} onSelect={() => go(d.href)}>
                      <Database className="i i-sm" aria-hidden="true" />
                      {d.label}
                      {d.hint && <span className="end">{d.hint}</span>}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading="Pages">
                {PAGES.map((p) => (
                  <Command.Item key={p.id} value={`page ${p.label}`} onSelect={() => go(p.href)}>
                    <p.icon className="i i-sm" aria-hidden="true" />
                    {p.label}
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
