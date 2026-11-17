'use client';

import { ArrowLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';

/**
 * The head of a detail screen (04 New project, 05 Setup), as the artboards draw it: on desktop the topbar with
 * breadcrumbs, the title and the actions; on phone a back arrow, the title and one action, and no tab bar.
 */
export function DetailHead({
  crumbs,
  title,
  actions,
  phoneTitle,
  phoneMicro,
  phoneAction,
  back = '/projects',
}: {
  crumbs: { label: string; href?: string }[];
  title: ReactNode;
  actions?: ReactNode;
  phoneTitle?: ReactNode;
  phoneMicro?: ReactNode;
  phoneAction?: ReactNode;
  back?: string;
}) {
  useDetailScreen();
  return (
    <>
      <header className="topbar">
        <div className="topbar-title">
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={`${c.label}-${i}`} style={{ display: 'contents' }}>
                {i > 0 && <ChevronRight className="i" aria-hidden="true" />}
                {c.href ? <Link href={c.href}>{c.label}</Link> : <span>{c.label}</span>}
              </span>
            ))}
          </nav>
          <h1>{title}</h1>
        </div>
        {actions}
      </header>
      <header className="mhead">
        <Link className="btn btn-sm btn-icon btn-ghost" href={back} aria-label="Back to projects">
          <ArrowLeft className="i" aria-hidden="true" />
        </Link>
        {phoneMicro ? (
          <div className="grow">
            <div className="micro">{phoneMicro}</div>
            <div className="mhead-title">{phoneTitle ?? title}</div>
          </div>
        ) : (
          <div className="mhead-title">{phoneTitle ?? title}</div>
        )}
        {phoneAction}
      </header>
    </>
  );
}

/**
 * Marks the shell as a detail screen (the canvas's .app.is-detail), which hides the phone tab bar. The shell
 * is chat F's, so the class goes on from here while the screen is open.
 */
export function useDetailScreen() {
  useEffect(() => {
    const app = document.querySelector('.app');
    app?.classList.add('is-detail');
    return () => app?.classList.remove('is-detail');
  }, []);
}
