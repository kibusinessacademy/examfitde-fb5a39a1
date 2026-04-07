import { Link } from "react-router-dom";
import { BRAND } from "@/lib/brand/ssot";

interface GrowthBrandHeaderProps {
  /** Optional subtitle shown below brand */
  subtitle?: string;
}

/**
 * Compact brand header for Growth Engine SEO pages.
 * Shows ExamFit logo mark + name + link to home.
 */
export function GrowthBrandHeader({ subtitle }: GrowthBrandHeaderProps) {
  return (
    <div className="flex items-center justify-between py-4 mb-6 border-b border-border/40">
      <Link to="/" className="flex items-center gap-2 group">
        <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center group-hover:bg-primary/90 transition-colors">
          <span className="text-primary-foreground text-xs font-bold">E</span>
        </div>
        <div>
          <span className="text-sm font-semibold text-foreground">{BRAND.name}</span>
          {subtitle && (
            <span className="text-xs text-muted-foreground ml-2">{subtitle}</span>
          )}
        </div>
      </Link>
      <Link
        to="/shop"
        className="text-xs font-medium text-primary hover:underline hidden sm:block"
      >
        Prüfungstraining →
      </Link>
    </div>
  );
}
