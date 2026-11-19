import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-500 text-cream shadow-[0_14px_30px_-18px_rgba(78,36,19,0.85)] hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-brand-500',
  secondary:
    'bg-espresso text-cream hover:bg-choco active:bg-ink focus-visible:outline-espresso',
  outline:
    'border border-line bg-transparent text-ink hover:border-brand-400 hover:bg-brand-50/60 hover:text-brand-700 focus-visible:outline-brand-500',
  ghost: 'text-muted hover:bg-espresso/5 hover:text-ink focus-visible:outline-brand-500',
  danger: 'bg-danger-500 text-white hover:bg-danger-600 focus-visible:outline-danger-500',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-xs rounded-full gap-1.5',
  md: 'h-11 px-5 text-sm rounded-full gap-2',
  lg: 'h-12 px-7 text-sm rounded-full gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading = false, fullWidth, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center font-medium',
        'focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-55',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? <Spinner size="sm" className="text-current" /> : null}
      {children}
    </button>
  );
});
