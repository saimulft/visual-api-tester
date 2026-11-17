import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

/** Small pieces from the canvas: LEDs, chips, tags, monograms, keys, cards, panels, KPIs and states. */

export type LedState = 'live' | 'connected' | 'paused' | 'failed' | 'ai' | 'warn';

/** An LED with a halo. `live` pulses three times, then rests. */
export function Led({
  state = 'connected',
  label,
  className,
}: {
  state?: LedState;
  label?: string;
  className?: string;
}) {
  const cls = {
    live: 'is-live',
    connected: '',
    paused: 'is-off',
    failed: 'is-err',
    ai: 'is-ai is-live',
    warn: 'is-warn',
  }[state];
  return (
    <span
      className={cn('led', cls, className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

export type ChipTone = 'default' | 'on' | 'ai' | 'soft' | 'warn' | 'err' | 'dark';

export function Chip({ tone = 'default', className, children, ...rest }: { tone?: ChipTone } & ComponentProps<'span'>) {
  return (
    <span className={cn('chip', tone !== 'default' && `is-${tone}`, className)} {...rest}>
      {children}
    </span>
  );
}

/** A chip that's a button (suggestions, presets in a filter row). */
export function ChipButton({
  tone = 'default',
  className,
  children,
  type = 'button',
  ...rest
}: { tone?: ChipTone } & ComponentProps<'button'>) {
  return (
    <button type={type} className={cn('chip', tone !== 'default' && `is-${tone}`, className)} {...rest}>
      {children}
    </button>
  );
}

/** A small square label: HTTP methods, a kind, "free". */
export function Tag({
  className,
  children,
  tone,
}: {
  className?: string;
  children: ReactNode;
  tone?: 'get' | 'post' | 'free';
}) {
  if (tone === 'get' || tone === 'post')
    return <span className={cn('method', tone === 'get' && 'get', className)}>{children}</span>;
  return <span className={cn('tag', tone === 'free' && 'is-free', className)}>{children}</span>;
}

export type MonogramTone = 'default' | 'signal' | 'ai' | 'ink' | 'warm';

/** A project's monogram tile (no third-party logos). */
export function Monogram({
  text,
  tone = 'default',
  size = 'md',
  className,
}: {
  text: string;
  tone?: MonogramTone;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <span
      className={cn('mtile', tone !== 'default' && `is-${tone}`, size !== 'md' && size, className)}
      aria-hidden="true"
    >
      {text.slice(0, 3).toUpperCase()}
    </span>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('kbd', className)}>{children}</kbd>;
}

export function Card({ className, children, ...rest }: ComponentProps<'div'>) {
  return (
    <div className={cn('card', className)} {...rest}>
      {children}
    </div>
  );
}

export function Panel({
  title,
  actions,
  className,
  children,
  ...rest
}: { title?: ReactNode; actions?: ReactNode } & Omit<ComponentProps<'section'>, 'title'>) {
  return (
    <section className={cn('panel', className)} {...rest}>
      {(title || actions) && (
        <div className="panel-head">
          {title && <h2 className="panel-title">{title}</h2>}
          {actions && (
            <div className="row" style={{ marginLeft: 'auto' }}>
              {actions}
            </div>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

/** A KPI tile: a micro label, a big tabular number and a line under it. */
export function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="kpi">
      <span className="micro">{label}</span>
      <span className="kpi-val num">{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

/** What a list shows when it's empty: what goes here, and the one thing to do. */
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && <span className="empty-ico">{icon}</span>}
      <h3 className="empty-title">{title}</h3>
      {children && <p className="empty-text">{children}</p>}
      {action}
    </div>
  );
}

/** A loading placeholder in the shape of what's coming. */
export function Skeleton({
  width,
  height = 14,
  radius,
  className,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  className?: string;
}) {
  return <span className={cn('skel', className)} style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}

/** The Dialed logo. `word` adds the wordmark. */
export function Logo({
  word = true,
  href,
  label = 'Dialed home',
  className,
}: {
  word?: boolean;
  href?: string;
  label?: string;
  className?: string;
}) {
  const mark = (
    <svg className="logo-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect className="bg" width="32" height="32" rx="9" />
      <circle className="d" cx="16" cy="17.5" r="7" />
      <path className="d" d="M16 17.5l4-4.2" />
      <path className="t" d="M7.6 10.4l-1.3-1.1M16 7V5.2M24.4 10.4l1.3-1.1" />
    </svg>
  );
  const inner = (
    <>
      {mark}
      {word && <span className="logo-word">dialed</span>}
    </>
  );
  return href ? (
    <a className={cn('logo', className)} href={href} aria-label={label}>
      {inner}
    </a>
  ) : (
    <span className={cn('logo', className)} aria-label={label} role="img">
      {inner}
    </span>
  );
}

/** Provenance dot after a label: violet for what the AI set, teal for what you changed. */
export function Prov({ by }: { by: 'ai' | 'you' }) {
  return (
    <span
      className={cn('prov', by === 'you' && 'you')}
      role="img"
      aria-label={by === 'ai' ? 'Set by AI' : 'Changed by you'}
    />
  );
}

/** The violet and teal legend. */
export function ProvLegend() {
  return (
    <span className="legend">
      <span>
        <Prov by="ai" />
        Set by AI
      </span>
      <span>
        <Prov by="you" />
        Changed by you
      </span>
    </span>
  );
}
