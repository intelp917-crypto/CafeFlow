import { useEffect, type ReactNode } from 'react';
import { cn } from './cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const SIZES = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative w-full overflow-hidden rounded-[1.5rem] border border-line bg-surface shadow-[0_40px_120px_-40px_rgba(36,22,17,0.6)]',
          SIZES[size],
        )}
      >
        <header className="border-b border-line bg-cream/50 px-6 py-5">
          <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
          {description ? <p className="mt-1 text-xs leading-6 text-muted">{description}</p> : null}
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer ? <footer className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</footer> : null}
      </div>
    </div>
  );
}
