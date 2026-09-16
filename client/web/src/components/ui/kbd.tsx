import * as React from 'react';

import { cn } from '../../lib/utils';

const Kbd = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <kbd
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1 font-mono text-base font-semibold',
        className,
      )}
      {...props}
    />
  ),
);
Kbd.displayName = 'Kbd';

export { Kbd };
