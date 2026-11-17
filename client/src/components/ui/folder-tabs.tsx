'use client';

import type { ReactNode } from 'react';

/** Folder tabs (the results stage's Table, JSON and Request). Arrow keys move between tabs. */
export function FolderTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  meta,
  idBase,
}: {
  tabs: { value: T; label: ReactNode; count?: number | string; icon?: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  meta?: ReactNode;
  /** Tab ids are `${idBase}-tab-${value}` and their panels `${idBase}-panel-${value}`. */
  idBase: string;
}) {
  const move = (index: number) => {
    const next = tabs[(index + tabs.length) % tabs.length];
    onChange(next.value);
    document.getElementById(`${idBase}-tab-${next.value}`)?.focus();
  };
  return (
    <div className="ftabs" role="tablist" aria-label={label}>
      {tabs.map((tab, i) => (
        <button
          key={tab.value}
          id={`${idBase}-tab-${tab.value}`}
          className="ftab"
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          aria-controls={`${idBase}-panel-${tab.value}`}
          tabIndex={tab.value === value ? 0 : -1}
          onClick={() => onChange(tab.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') move(i + 1);
            if (e.key === 'ArrowLeft') move(i - 1);
          }}
        >
          {tab.icon}
          {tab.label}
          {tab.count !== undefined && <span className="ftab-count">{tab.count}</span>}
        </button>
      ))}
      {meta && <span className="ftabs-meta">{meta}</span>}
    </div>
  );
}

/** The panel under a folder tab. */
export function TabPanel({
  idBase,
  value,
  active,
  children,
}: {
  idBase: string;
  value: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div
      id={`${idBase}-panel-${value}`}
      role="tabpanel"
      aria-labelledby={`${idBase}-tab-${value}`}
      hidden={!active}
      className="stage-body"
    >
      {children}
    </div>
  );
}
