import type { ReactNode } from 'react';

/**
 * Collapses prior results upward while mail process runs; expands when done.
 */
export function MailProcessResults({
  collapsed,
  contentKey,
  children,
}: {
  collapsed: boolean;
  /** Change when a new briefing snapshot arrives (re-triggers expand). */
  contentKey: string | number;
  children: ReactNode;
}) {
  return (
    <div
      className={`mail-process-results${collapsed ? ' mail-process-results--collapsed' : ' mail-process-results--expanded'}`}
      aria-hidden={collapsed}
    >
      <div className="mail-process-results__inner" key={contentKey}>
        {children}
      </div>
    </div>
  );
}
