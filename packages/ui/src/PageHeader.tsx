import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        {breadcrumb ? <div className="text-[11px] text-muted">{breadcrumb}</div> : null}
        <h1 className="text-xl font-bold tracking-tight text-ink">{title}</h1>
        {description ? <p className="max-w-2xl text-xs leading-6 text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
