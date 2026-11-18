import { cn } from './cn';

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  /** Persian description read by screen readers. */
  describedBy?: string;
}

export function Switch({ checked, onChange, disabled, label, describedBy }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
        checked ? 'bg-brand-500' : 'bg-sec-300',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 start-0.5 inline-block size-5 rounded-full bg-white shadow transition-[inset-inline-start] duration-150',
          checked && 'start-[22px]',
        )}
      />
    </button>
  );
}
