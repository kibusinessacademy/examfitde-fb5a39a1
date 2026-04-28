import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export type WeaknessRow = {
  competency_id: string;
  competency_title: string;
  learning_field_title: string;
  mastery_level: string;
  score: number;
  attempts: number;
};

interface WeaknessListProps {
  items: WeaknessRow[];
  isLoading?: boolean;
  className?: string;
  maxItems?: number;
}

export function WeaknessList({
  items,
  isLoading,
  className,
  maxItems = 6,
}: WeaknessListProps) {
  if (isLoading) {
    return (
      <Card variant="raised" className={className}>
        <CardContent className="p-6">
          <div className="h-24 animate-pulse rounded-lg bg-surface-sunken" />
        </CardContent>
      </Card>
    );
  }

  if (!items.length) return null;

  return (
    <Card variant="raised" className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-display text-text-primary">
          <AlertTriangle className="h-5 w-5 text-warning" />
          Schwächste Bereiche
        </CardTitle>
      </CardHeader>
      <CardContent className="p-5 pt-0 space-y-2.5">
        {items.slice(0, maxItems).map((item) => {
          const scorePct = Math.round((item.score ?? 0) * 100);
          const critical = scorePct < 50;
          return (
            <div
              key={item.competency_id}
              className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-sunken p-3 transition-colors duration-base ease-out-expo hover:border-border-strong hover:bg-surface"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate text-text-primary">
                  {item.competency_title}
                </div>
                <div className="text-xs text-text-tertiary">
                  {item.learning_field_title}
                  {item.attempts > 0 && ` · ${item.attempts} Versuch${item.attempts > 1 ? "e" : ""}`}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Progress
                  value={scorePct}
                  className={cn(
                    "w-16 h-2",
                    critical ? "[&>div]:bg-destructive" : "[&>div]:bg-warning",
                  )}
                />
                <span
                  className={cn(
                    "text-xs font-semibold w-9 text-right tabular-nums",
                    critical ? "text-destructive" : "text-warning",
                  )}
                >
                  {scorePct}%
                </span>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
