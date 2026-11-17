'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Me } from '@/contracts/auth';

/** The signed-in person and the palette's open state, for every part of the shell. */
type Shell = { user: Me; paletteOpen: boolean; setPaletteOpen: (open: boolean) => void };

const ShellContext = createContext<Shell | null>(null);

export function ShellProvider({ user, children }: { user: Me; children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  return <ShellContext.Provider value={{ user, paletteOpen, setPaletteOpen }}>{children}</ShellContext.Provider>;
}

export function useShell(): Shell {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error('useShell needs the (app) layout around it.');
  return shell;
}
