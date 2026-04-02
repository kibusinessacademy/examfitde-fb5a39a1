import * as React from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
  SheetClose,
  SheetFooter,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type AdminSheetProps = React.ComponentProps<typeof Sheet>;

/**
 * Admin-specific Sheet wrapper that enforces modal={false}
 * to prevent body-level pointer-events locks from Radix UI.
 *
 * For blocking confirm/danger dialogs, use AlertDialog instead.
 */
export function AdminSheet(props: AdminSheetProps) {
  return <Sheet modal={false} {...props} />;
}

type AdminSheetContentProps = React.ComponentProps<typeof SheetContent>;

export function AdminSheetContent({
  className,
  ...props
}: AdminSheetContentProps) {
  return (
    <SheetContent
      className={cn("overflow-y-auto", className)}
      {...props}
    />
  );
}

// Re-export non-modified sub-components for convenience
export {
  SheetHeader as AdminSheetHeader,
  SheetTitle as AdminSheetTitle,
  SheetDescription as AdminSheetDescription,
  SheetTrigger as AdminSheetTrigger,
  SheetClose as AdminSheetClose,
  SheetFooter as AdminSheetFooter,
};
