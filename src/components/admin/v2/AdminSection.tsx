/**
 * AdminSection — Unified Card-Section
 * ───────────────────────────────────
 * Konsistente Section-Card mit optionalem Titel + Icon. Gewährleistet das
 * gleiche Padding/Spacing über alle Admin-Bereiche hinweg.
 */
import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface AdminSectionProps {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** kein Padding & keine Card — nutzt nur die Header-Struktur */
  bare?: boolean;
}

export function AdminSection({
  icon: Icon,
  title,
  description,
  actions,
  children,
  className,
  bare,
}: AdminSectionProps) {
  const headerVisible = title || description || Icon || actions;

  const inner = (
    <>
      {headerVisible && (
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-start gap-2 min-w-0">
            {Icon && (
              <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            )}
            <div className="min-w-0">
              {title && (
                <h2 className="text-sm font-semibold text-foreground leading-tight">
                  {title}
                </h2>
              )}
              {description && (
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                  {description}
                </p>
              )}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      {children}
    </>
  );

  if (bare) return <section className={cn("space-y-3", className)}>{inner}</section>;

  return <Card className={cn("p-4", className)}>{inner}</Card>;
}
