import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-[background-color,border-color,color,box-shadow,transform] duration-base ease-out-expo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Core
        default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-elev-1 hover:shadow-elev-2",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-elev-1",
        outline:
          "border border-border-strong bg-surface text-text-primary hover:bg-surface-sunken hover:border-border-focus",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "text-text-secondary hover:bg-surface-sunken hover:text-text-primary",
        link: "text-primary underline-offset-4 hover:underline",
        // Identity v2
        petrol:
          "bg-petrol-600 text-text-on-petrol hover:bg-petrol-500 shadow-elev-2 hover:shadow-elev-3 active:scale-[0.98]",
        mint: "bg-mint-500 text-petrol-900 hover:bg-mint-400 shadow-elev-1 hover:shadow-elev-2",
        // Status v2 (subtle, for non-primary actions in admin)
        success:
          "bg-success-bg-subtle text-success border border-success-border hover:bg-success-bg-subtle",
        warning:
          "bg-warning-bg-subtle text-warning border border-warning-border hover:bg-warning-bg-subtle",
        info: "bg-info-bg-subtle text-info border border-info-border hover:bg-info-bg-subtle",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        xl: "h-12 rounded-lg px-10 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
