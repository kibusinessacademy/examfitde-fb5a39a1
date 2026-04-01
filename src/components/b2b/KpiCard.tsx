import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  className?: string;
  valueClassName?: string;
  onClick?: () => void;
}

export default function KpiCard({ title, value, subtitle, icon: Icon, className, valueClassName, onClick }: KpiCardProps) {
  return (
    <Card
      className={cn(
        "border border-border/60 transition-all",
        onClick && "cursor-pointer hover:ring-2 hover:ring-primary/30 active:scale-[0.98]",
        className
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <CardContent className="p-4 flex items-start gap-3">
        {Icon && (
          <div className="shrink-0 rounded-lg bg-primary/10 p-2.5">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground font-medium truncate">{title}</p>
          <p className={cn("text-2xl font-bold tracking-tight", valueClassName)}>{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
