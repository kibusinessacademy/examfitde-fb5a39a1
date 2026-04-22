/**
 * QueueHealthcheckBanner
 * ──────────────────────
 * Zeigt System-Healthcheck-Warnungen aus admin_queue_system_healthcheck() im Cockpit.
 * Macht Drift zwischen View ↔ fn_auto_heal_cluster ↔ erwarteten RPCs sofort sichtbar.
 *
 * SSOT: keine eigene Cluster-Interpretation, nur Pass-through der Backend-Diagnose.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, ShieldCheck, AlertOctagon } from "lucide-react";
import { cn } from "@/lib/utils";

type HealthStatus = "ok" | "warn" | "fail" | string;

interface HealthcheckIssue {
  code: string;
  severity: "high" | "medium" | "info" | string;
  message: string;
  items?: string[];
}

interface HealthcheckResponse {
  status: HealthStatus;
  checked_at?: string;
  issues?: HealthcheckIssue[];
  view_clusters?: string[];
  heal_clusters?: string[];
}

const SEVERITY_CLS: Record<string, string> = {
  high: "border-destructive/40 bg-destructive/10 text-destructive",
  medium: "border-warning/40 bg-warning/10 text-warning",
  info: "border-border bg-muted/30 text-foreground",
};

export function QueueHealthcheckBanner() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["queue-system-healthcheck"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_queue_system_healthcheck" as any,
      );
      if (error) throw error;
      return data as unknown as HealthcheckResponse;
    },
    refetchInterval: 60_000,
    retry: 1,
  });

  if (isLoading || error || !data) return null;

  const issues = data.issues ?? [];
  // SSOT-Konsistenz: ein "fail"/"warn"-Status ohne Issues ist semantisch leer.
  // Wir zeigen das Banner nur, wenn es echte Issues gibt — sonst Backend-Drift,
  // den wir nicht als FAIL · 0 Issues falsch darstellen wollen.
  if (issues.length === 0) return null;

  const isFail = data.status === "fail";
  const wrapperCls = isFail
    ? "border-destructive/40 bg-destructive/5"
    : "border-warning/40 bg-warning/5";
  const Icon = isFail ? AlertOctagon : ShieldAlert;
  const iconCls = isFail ? "text-destructive" : "text-warning";

  return (
    <Card className={cn("border-2", wrapperCls)}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4 shrink-0", iconCls)} />
          <span className="text-sm font-semibold">Queue-System Healthcheck</span>
          <Badge
            variant="outline"
            className={cn(
              "h-4 px-1.5 text-[9px]",
              isFail ? SEVERITY_CLS.high : SEVERITY_CLS.medium,
            )}
          >
            {data.status?.toUpperCase()}
          </Badge>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {issues.length} Issue{issues.length !== 1 && "s"}
          </span>
        </div>

        <div className="space-y-1.5">
          {issues.slice(0, 5).map((i, idx) => {
            const cls = SEVERITY_CLS[i.severity] ?? SEVERITY_CLS.info;
            return (
              <div
                key={`${i.code}-${idx}`}
                className={cn(
                  "rounded border px-2 py-1.5 text-[11px] space-y-0.5",
                  cls,
                )}
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono text-[10px] font-bold">{i.code}</span>
                  <Badge variant="outline" className="h-4 px-1 text-[9px]">
                    {i.severity}
                  </Badge>
                </div>
                <div className="opacity-90">{i.message}</div>
                {i.items && i.items.length > 0 && (
                  <div className="font-mono text-[10px] flex flex-wrap gap-1 pt-0.5">
                    {i.items.slice(0, 8).map((it) => (
                      <span
                        key={it}
                        className="rounded bg-background/60 px-1 py-0.5 border border-border/60"
                      >
                        {it}
                      </span>
                    ))}
                    {i.items.length > 8 && (
                      <span className="text-muted-foreground">
                        +{i.items.length - 8}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {issues.length > 5 && (
            <div className="text-[10px] text-muted-foreground">
              … +{issues.length - 5} weitere Issues (siehe admin_queue_system_healthcheck)
            </div>
          )}
        </div>

        {data.status === "ok" && (
          <div className="flex items-center gap-1.5 text-[11px] text-success">
            <ShieldCheck className="h-3 w-3" /> System konsistent
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default QueueHealthcheckBanner;
