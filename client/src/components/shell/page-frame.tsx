import type { ReactNode } from 'react';
import { cn } from '@/components/ui';

/**
 * The page under the topbar: the rack background, the 1240 column and an optional head. `side` makes the
 * two-column frame with a sticky side panel (data, schedules, settings).
 */
export function PageFrame({
  title,
  sub,
  actions,
  side,
  white,
  children,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  side?: ReactNode;
  white?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn('page', white && 'is-white')}>
      <div className="page-in">
        {(title || actions) && (
          <div className="page-head">
            <div>
              {title && <h2 className="page-title">{title}</h2>}
              {sub && <p className="page-sub">{sub}</p>}
            </div>
            {actions}
          </div>
        )}
        {side ? (
          <div className="frame">
            <div className="frame-main">{children}</div>
            <aside className="frame-side">{side}</aside>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
