/**
 * Berufs-KI Usage Intelligence (BK-Act-2).
 *
 * Outcome-focused dashboard tile: today's usage, time saved, top workflows,
 * capacity hint — never raw "X/Y runs".
 */
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Sparkles, TrendingUp, Layers, Flame } from "lucide-react";
import { capacityHintLabel, formatMinutesSaved } from "@/lib/berufs-ki/revenue";
import { CATEGORY_LABEL, tierLabel } from "@/lib/berufs-ki/copy";
import { useWorkflowUsageSummary } from "@/hooks/useBerufsKiRevenueUX";
import type { WorkflowCategory } from "@/lib/berufs-ki/types";

export function UsageIntelligenceCard({ onOpenWorkflow }: { onOpenWorkflow?: (slug: string) => void }) {
  const { data, isLoading } = useWorkflowUsageSummary(7);

  if (isLoading || !data || data.error) return null;

  const topCategory = data.categories[0]?.category as WorkflowCategory | undefined;

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Deine Berufs-KI-Woche</span>
          <Badge variant="secondary" className="ml-auto text-[10px]">{tierLabel(data.tier)}</Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric
            icon={<Clock className="h-4 w-4" />}
            value={formatMinutesSaved(data.minutes_saved_window)}
            label="Zeitersparnis 7 Tage"
            highlight
          />
          <Metric
            icon={<TrendingUp className="h-4 w-4" />}
            value={`${data.runs_window}`}
            label="Workflows ausgeführt"
          />
          <Metric
            icon={<Layers className="h-4 w-4" />}
            value={`${data.distinct_workflows}`}
            label="Unterschiedliche Workflows"
          />
          <Metric
            icon={<Flame className="h-4 w-4" />}
            value={data.heavy_runs_today > 0 ? `${data.heavy_runs_today} heavy` : "Standard"}
            label="Arbeitslast heute"
          />
        </div>

        <p className="text-xs text-muted-foreground">{capacityHintLabel(data.capacity_hint, data.tier)}</p>

        {data.top_workflows.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Meistgenutzte Workflows
            </div>
            <ul className="space-y-1">
              {data.top_workflows.slice(0, 3).map((w) => (
                <li key={w.slug}>
                  <button
                    onClick={() => onOpenWorkflow?.(w.slug)}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50"
                  >
                    <span className="truncate">{w.title}</span>
                    <span className="ml-3 shrink-0 text-xs text-muted-foreground">{w.runs}×</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {topCategory && CATEGORY_LABEL[topCategory] && (
          <p className="text-xs text-muted-foreground">
            Stärkster Bereich: <span className="font-medium text-foreground">{CATEGORY_LABEL[topCategory]}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({
  icon,
  value,
  label,
  highlight,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "border-primary/40 bg-primary/5" : "bg-card"}`}>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[10px] uppercase tracking-wide">{label}</span>
      </div>
      <div className={`mt-1 text-sm font-semibold ${highlight ? "text-primary" : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}
