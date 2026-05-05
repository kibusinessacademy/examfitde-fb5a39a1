/**
 * AlertsBanner — Council-Deferred + Deferred-Resolved Alerts mit One-Click Heal.
 *
 * Aktionen:
 *  • "Bulk Resume" für alle deferred Pakete (admin_resume_council_deferred)
 *  • "Resume" pro Paket (admin_resume_single_council_deferred)
 *  • "Re-Enqueue" pro Paket aus DEFERRED-Resolved (queue_eligibility wiederhergestellt)
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Pause, ShieldAlert, Play, RefreshCw, Loader2 } from "lucide-react";

export function AlertsBanner() {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

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

  const bulkResume = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const { data, error } = await supabase.rpc("admin_resume_council_deferred" as any, {
        p_dry_run: dryRun,
        p_max_packages: 50,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (data, dryRun) => {
      if (dryRun) {
        toast({
          title: "Dry-Run Council Resume",
          description: `${data?.packages ?? 0} Paket(e) bereit zum Resume`,
        });
      } else {
        toast({
          title: "Council-Deferred resumed",
          description: `${data?.packages ?? 0} Paket(e) reaktiviert. Quality-Council läuft erneut.`,
        });
        qc.invalidateQueries({ queryKey: ["council-deferred"] });
        qc.invalidateQueries({ queryKey: ["deferred-resolved-alerts"] });
      }
    },
    onError: (e: Error) =>
      toast({ title: "Bulk Resume fehlgeschlagen", description: e.message, variant: "destructive" }),
  });

  const singleResume = useMutation({
    mutationFn: async (packageId: string) => {
      setBusyId(packageId);
      const { data, error } = await supabase.rpc("admin_resume_single_council_deferred" as any, {
        p_package_id: packageId,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (data) => {
      toast({
        title: "Paket resumed",
        description: `Quality-Council für ${String(data?.package_id ?? "").slice(0, 8)} neu enqueued`,
      });
      qc.invalidateQueries({ queryKey: ["council-deferred"] });
    },
    onError: (e: Error) =>
      toast({ title: "Resume fehlgeschlagen", description: e.message, variant: "destructive" }),
    onSettled: () => setBusyId(null),
  });

  const reEnqueue = useMutation({
    mutationFn: async (packageId: string) => {
      setBusyId(packageId);
      // generic re-enqueue: nutzt admin_resume_single (deckt auch deferred resolved ab)
      const { data, error } = await supabase.rpc("admin_resume_single_council_deferred" as any, {
        p_package_id: packageId,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: () => {
      toast({ title: "Re-Enqueue ausgelöst", description: "Pipeline läuft weiter." });
      qc.invalidateQueries({ queryKey: ["deferred-resolved-alerts"] });
    },
    onError: (e: Error) =>
      toast({ title: "Re-Enqueue fehlgeschlagen", description: e.message, variant: "destructive" }),
    onSettled: () => setBusyId(null),
  });

  return (
    <div className="space-y-3">
      {councilDeferred.data && councilDeferred.data.length > 0 && (
        <Card className="p-4 border-secondary/40 bg-secondary/10">
          <div className="flex items-start gap-2 mb-3">
            <Pause className="h-4 w-4 mt-0.5 text-secondary-foreground" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold">
                {councilDeferred.data.length} Paket(e) Council-Deferred (Auto-Skip nach 3× Stale-Fail)
              </h3>
              <p className="text-xs text-muted-foreground">
                Diese Pakete blockieren publish_readiness nicht mehr — Council wurde wegen
                wiederholter Worker-Liveness-Fehler übersprungen.
              </p>
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <Button
                size="sm"
                variant="outline"
                onClick={() => bulkResume.mutate(true)}
                disabled={bulkResume.isPending}
                className="h-7 text-[11px]"
              >
                {bulkResume.isPending && bulkResume.variables === true ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3 mr-1" />
                )}
                Dry-Run
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={() => bulkResume.mutate(false)}
                disabled={bulkResume.isPending}
                className="h-7 text-[11px]"
              >
                {bulkResume.isPending && bulkResume.variables === false ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Play className="h-3 w-3 mr-1" />
                )}
                Bulk Resume
              </Button>
            </div>
          </div>
          <div className="space-y-1 max-h-60 overflow-auto">
            {councilDeferred.data.map((p: any) => (
              <div
                key={p.defer_id}
                className="flex items-center justify-between text-xs py-1.5 border-t border-border/40 first:border-0"
              >
                <span className="truncate flex-1 min-w-0">
                  <span className="font-mono text-[10px] text-muted-foreground mr-2">
                    {String(p.package_id).slice(0, 8)}
                  </span>
                  {p.package_title}
                </span>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <Badge variant="outline" className="text-[10px]">{p.defer_reason}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{p.fail_count}× fail</Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => singleResume.mutate(p.package_id)}
                    disabled={busyId === p.package_id}
                    aria-label={`Resume ${p.package_title}`}
                  >
                    {busyId === p.package_id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <>
                        <Play className="h-3 w-3 mr-1" />
                        Resume
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {alerts.data && alerts.data.length > 0 && (
        <Card className="p-4 border-warning/40 bg-warning-bg-subtle">
          <div className="flex items-start gap-2 mb-2">
            <ShieldAlert className="h-4 w-4 text-warning mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold">
                {alerts.data.length} Paket(e) DEFERRED — Bedingung jetzt erfüllt
              </h3>
              <p className="text-xs text-muted-foreground">
                Diese Pakete können sicher re-enqueued werden — One-Click via "Re-Enqueue".
              </p>
            </div>
          </div>
          <div className="space-y-1 max-h-60 overflow-auto">
            {alerts.data.map((a: any) => (
              <div
                key={a.package_id}
                className="flex items-center justify-between text-xs py-1.5 border-t border-border/40 first:border-0"
              >
                <div className="min-w-0 truncate flex-1">
                  <span className="font-mono text-[10px] text-muted-foreground mr-2">
                    {String(a.package_id).slice(0, 8)}
                  </span>
                  {a.course_title}
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <Badge variant="outline" className="text-[10px]">{a.defer_reason}</Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    {a.approved_exam_questions}/{a.min_required}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => reEnqueue.mutate(a.package_id)}
                    disabled={busyId === a.package_id}
                    aria-label={`Re-Enqueue ${a.course_title}`}
                  >
                    {busyId === a.package_id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <>
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Re-Enqueue
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
