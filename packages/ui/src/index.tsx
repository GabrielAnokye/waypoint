import type { PropsWithChildren, ReactNode } from 'react';

export interface AppShellProps extends PropsWithChildren {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  nav?: ReactNode;
}

/**
 * Shared shell component for side-panel and management surfaces.
 */
export function AppShell({
  title,
  subtitle,
  actions,
  nav,
  children
}: AppShellProps) {
  return (
    <div className="wp-shell">
      <header className="wp-shell__header">
        <div>
          <p className="wp-shell__eyebrow">Waypoint</p>
          <h1 className="wp-shell__title">{title}</h1>
          <p className="wp-shell__subtitle">{subtitle}</p>
        </div>
        {actions ? <div className="wp-shell__actions">{actions}</div> : null}
      </header>
      {nav ? <nav className="wp-shell__nav">{nav}</nav> : null}
      <main className="wp-shell__body">{children}</main>
    </div>
  );
}
