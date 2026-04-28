import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-base text-text-primary ring-offset-background transition-[border-color,box-shadow] duration-base ease-out-expo file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-text-primary placeholder:text-text-tertiary hover:border-border-focus focus-visible:outline-none focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-surface-sunken md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
