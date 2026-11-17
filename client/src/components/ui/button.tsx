import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

/**
 * Buttons from the canvas: primary, secondary (the plain .btn), ghost, danger, dark and AI, in three sizes,
 * with the DL icon tile (`tile`) and the square icon button (`icon`). Pass `href` for a link that looks
 * like a button.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark' | 'ai';
export type ButtonSize = 'sm' | 'md' | 'lg';

type Common = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** An icon in a tile on the left (the canvas's .has-tile): pass the icon. */
  tile?: ReactNode;
  /** A square button holding only an icon: give it an aria-label. */
  icon?: boolean;
  block?: boolean;
  /** Shows a spinner and blocks clicks. */
  busy?: boolean;
};

export function buttonClass({
  variant = 'secondary',
  size = 'md',
  tile,
  icon,
  block,
  className,
}: Common & { className?: string }) {
  return cn(
    'btn',
    variant !== 'secondary' && `btn-${variant}`,
    size !== 'md' && `btn-${size}`,
    tile !== undefined && 'has-tile',
    icon && 'btn-icon',
    block && 'btn-block',
    className,
  );
}

function Inner({ tile, busy, children, variant }: Common & { children?: ReactNode }) {
  const dark = variant === 'primary' || variant === 'dark';
  return (
    <>
      {tile !== undefined && (
        <span className="tile">{busy ? <span className={cn('spin', !dark && 'dark')} /> : tile}</span>
      )}
      {busy && tile === undefined && <span className={cn('spin', !dark && 'dark')} aria-hidden="true" />}
      {children}
    </>
  );
}

export function Button({
  variant,
  size,
  tile,
  icon,
  block,
  busy,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: Common & ComponentProps<'button'>) {
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, tile, icon, block, className })}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      <Inner tile={tile} busy={busy} variant={variant}>
        {children}
      </Inner>
    </button>
  );
}

export function ButtonLink({
  variant,
  size,
  tile,
  icon,
  block,
  className,
  children,
  href,
  ...rest
}: Common & ComponentProps<typeof Link>) {
  return (
    <Link href={href} className={buttonClass({ variant, size, tile, icon, block, className })} {...rest}>
      <Inner tile={tile} variant={variant}>
        {children}
      </Inner>
    </Link>
  );
}
