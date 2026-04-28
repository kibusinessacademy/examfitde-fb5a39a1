import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "border-border-strong text-text-primary",
        // ── Status v2 (token-based, no opacity hacks) ──
        success: "border-success-border bg-success-bg-subtle text-success",
        warning: "border-warning-border bg-warning-bg-subtle text-warning",
        info: "border-info-border bg-info-bg-subtle text-info",
        danger: "border-destructive-border bg-destructive-bg-subtle text-destructive",
        // Neutral chip (for counts, IDs, meta)
        muted: "border-border-subtle bg-surface-sunken text-text-secondary",
        // Identity
        petrol: "border-transparent bg-petrol-600 text-text-on-petrol",
        mint: "border-transparent bg-mint-500 text-petrol-900",
      },
      size: {
        default: "px-2.5 py-0.5 text-xs",
        sm: "px-2 py-0 text-[10px] leading-4",
        lg: "px-3 py-1 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, size, ...props }, ref) => {
    return <div ref={ref} className={cn(badgeVariants({ variant, size }), className)} {...props} />;
  }
);
Badge.displayName = "Badge";

export { Badge, badgeVariants };
