import { useQuery } from '@tanstack/react-query';
import { runAdminOpsAction } from '@/integrations/supabase/admin-ops-actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { AlertTriangle, TrendingDown } from 'lucide-react';

interface RootCauseGroup {
  job_type: string;
  pattern: string;
  count: number;
  sample: string;
}

export function RootCausePanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['leitstelle-root-causes'],
    queryFn: async () => {
      const res = await runAdminOpsAction('root_cause_summary', { hours: 24 });
      return res as { groups: RootCauseGroup[]; total: number; hours: number };
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (isLoading || !data?.groups?.length) return null;

  return (
    <Card className="border-border/70 bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-destructive" />
            Root Causes (24h)
          </span>
          <Badge variant="outline" className="text-[11px]">
            {data.total} Fehler
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.groups.slice(0, 8).map((g, i) => {
          const pct = data.total > 0 ? Math.round((g.count / data.total) * 100) : 0;
          return (
            <div
              key={i}
              className="rounded-lg border border-border/60 px-3 py-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className={cn(
                      "h-3 w-3 shrink-0",
                      g.count >= 10 ? "text-destructive" : "text-amber-500"
                    )} />
                    <span className="truncate text-sm font-medium font-mono">
                      {g.job_type.replace('package_', '')}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {g.pattern}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold">{g.count}×</div>
                  <div className="text-[10px] text-muted-foreground">{pct}%</div>
                </div>
              </div>
              {/* Percentage bar */}
              <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    pct >= 30 ? "bg-destructive" : pct >= 15 ? "bg-amber-500" : "bg-primary"
                  )}
                  style={{ width: `${Math.max(pct, 2)}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
