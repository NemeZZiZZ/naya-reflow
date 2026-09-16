import * as React from "react";
import { cn } from "../../lib/utils";

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-md border border-border bg-input px-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function InputGroupAddon({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="input-group-addon"
      className={cn("flex items-center gap-1.5", className)}
      {...props}
    />
  );
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input-group-input"
      className={cn(
        "flex-1 bg-transparent font-mono text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}

export { InputGroup, InputGroupAddon, InputGroupInput };
