/**
 * AlertsBanner — Council-Deferred + Deferred-Resolved Alerts.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pause, ShieldAlert } from "lucide-react";

export function AlertsBanner() {
  const alerts = useQuery({
    queryKey: ["deferred-resolved-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_admin_deferred_resolved_alerts" as any)
        .select("*");
      if (error) throw error;
      return (data ?? []) as any[];
    },
    refetchInterval: 60_000,
  });

  const councilDeferred = useQuery({
    queryKey: ["council-deferred"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_council_deferred_packages" as any)
        .select("*");
      if (error) throw error;
      return (data ?? []) as any[];
    },
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-3">
      {councilDeferred.data && councilDeferred.data.length > 0 && (
        <Card className="p-4 border-secondary/40 bg-secondary/10">
          <div className="flex items-start gap-2 mb-2">
            <Pause className="h-4 w-4 mt-0.5 text-secondary-foreground" />
            <div>
              <h3 className="text-sm font-semibold">
                {councilDeferred.data.length} Paket(e) Council-Deferred (Auto-Skip nach 3× Stale-Fail)
              </h3>
              <p className="text-xs text-muted-foreground">
                Diese Pakete blockieren publish_readiness nicht mehr — Council wurde wegen
                wiederholter Worker-Liveness-Fehler übersprungen.
              </p>
            </div>
          </div>
          <div className="space-y-1 max-h-40 overflow-auto">
            {councilDeferred.data.map((p: any) => (
              <div
                key={p.defer_id}
                className="flex items-center justify-between text-xs py-1 border-t border-border/40 first:border-0"
              >
                <span className="truncate">
                  <span className="font-mono text-[10px] text-muted-foreground mr-2">
                    {p.package_id.slice(0, 8)}
                  </span>
                  {p.package_title}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="text-[10px]">{p.defer_reason}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{p.fail_count}× fail</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {alerts.data && alerts.data.length > 0 && (
        <Card className="p-4 border-warning/40 bg-warning/5">
          <div className="flex items-start gap-2 mb-2">
            <ShieldAlert className="h-4 w-4 text-warning mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold">
                {alerts.data.length} Paket(e) DEFERRED — Bedingung jetzt erfüllt
              </h3>
              <p className="text-xs text-muted-foreground">
                Diese Pakete können sicher re-enqueued werden (Trigger: "Targeted Recheck →
                Execute").
              </p>
            </div>
          </div>
          <div className="space-y-1 max-h-40 overflow-auto">
            {alerts.data.map((a: any) => (
              <div
                key={a.package_id}
                className="flex items-center justify-between text-xs py-1 border-t border-border/40 first:border-0"
              >
                <div className="min-w-0 truncate">
                  <span className="font-mono text-[10px] text-muted-foreground mr-2">
                    {a.package_id.slice(0, 8)}
                  </span>
                  {a.course_title}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="text-[10px]">{a.defer_reason}</Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    {a.approved_exam_questions}/{a.min_required}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
