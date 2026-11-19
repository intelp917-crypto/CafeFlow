import type { ReactNode } from 'react';
import { cn } from './cn';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={cn(
        'rounded-[1.35rem] border border-line bg-surface shadow-[0_24px_60px_-46px_rgba(41,27,19,0.55)]',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-line/80 px-6 py-5', className)}>
      <div className="space-y-1">
        <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
        {description ? <p className="text-xs leading-6 text-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </header>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-6 py-5', className)}>{children}</div>;
}

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'brand' | 'success' | 'warning';
}

const STAT_TONES = {
  default: 'text-ink',
  brand: 'text-brand-600',
  success: 'text-success-600',
  warning: 'text-warning-600',
};

export function StatCard({ label, value, hint, tone = 'default' }: StatCardProps) {
  return (
    <Card className="p-6">
      <p className="text-[11px] font-medium tracking-wide text-muted">{label}</p>
      <p className={cn('num mt-2 text-2xl font-bold tracking-tight', STAT_TONES[tone])}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted">{hint}</p> : null}
    </Card>
  );
}
