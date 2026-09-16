import * as React from 'react';
import { cn } from '../../lib/utils';

// Styled native controls (shadcn look, no Radix overhead for 2-3 option selects).
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'h-9 rounded-md border border-border bg-input px-3 font-mono text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-9 rounded-md border border-border bg-input px-3 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 cursor-pointer',
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = 'Select';

export { Input, Select };
