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
      <Card className={cn("border-border", className)}>
        <CardContent className="p-6">
          <div className="h-24 animate-pulse rounded-lg bg-muted" />
        </CardContent>
      </Card>
    );
  }

  if (!items.length) return null;

  return (
    <Card className={cn("border-border", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-display">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          Schwächste Bereiche
        </CardTitle>
      </CardHeader>
      <CardContent className="p-5 pt-0 space-y-2.5">
        {items.slice(0, maxItems).map((item) => {
          const scorePct = Math.round((item.score ?? 0) * 100);
          return (
            <div
              key={item.competency_id}
              className="flex items-center gap-3 rounded-lg border border-border p-3"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {item.competency_title}
                </div>
                <div className="text-xs text-muted-foreground">
                  {item.learning_field_title}
                  {item.attempts > 0 && ` · ${item.attempts} Versuch${item.attempts > 1 ? "e" : ""}`}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Progress
                  value={scorePct}
                  className={cn(
                    "w-16 h-2",
                    scorePct < 50
                      ? "[&>div]:bg-rose-500"
                      : "[&>div]:bg-amber-500"
                  )}
                />
                <span className="text-xs font-medium w-8 text-right">
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
