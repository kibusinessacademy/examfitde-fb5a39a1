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
}

export default function KpiCard({ title, value, subtitle, icon: Icon, className, valueClassName }: KpiCardProps) {
  return (
    <Card className={cn("border border-border/60", className)}>
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
