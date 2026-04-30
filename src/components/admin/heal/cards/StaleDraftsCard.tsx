/**
 * StaleDraftsCard — Pakete mit ≥10 Drafts ohne Step-Fortschritt
 *
 * Quelle: View v_admin_stale_drafts_detection (SSOT exam_questions)
 * RPC:    admin_heal_stale_drafts(p_package_id) — rejects stale drafts + recheck integrity
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, RefreshCw, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  package_id: string;
  title: string;
  status: string;
  track: string;
  drafts: number;
  approved: number;
  active_jobs: number;
  draft_age_days: number | null;
  step_age_days: number | null;
  stale_flag: "STALE_HEAL_NEEDED" | "STALE_WATCH" | "OK";
};

function flagBadge(f: Row["stale_flag"]) {
  if (f === "STALE_HEAL_NEEDED")
    return <Badge variant="destructive">heal needed</Badge>;
  if (f === "STALE_WATCH")
    return <Badge className="bg-warning/15 text-warning border-warning/30">watch</Badge>;
  return <Badge variant="secondary">ok</Badge>;
}

export function StaleDraftsCard() {
  const qc = useQueryClient();
  const [healing, setHealing] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin", "stale-drafts-detection"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await (supabase as any)
        .from("v_admin_stale_drafts_detection")
        .select("*")
        .neq("stale_flag", "OK")
        .order("step_age_days", { ascending: false, nullsFirst: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 60_000,
  });

  async function heal(pkg: string, title: string) {
    setHealing(pkg);
    try {
      const { data, error } = await (supabase as any).rpc("admin_heal_stale_drafts", {
        p_package_id: pkg,
      });
      if (error) throw error;
      const res = data as { ok: boolean; rejected_drafts?: number; reason?: string };
      if (res?.ok) {
        toast.success(`${title}: ${res.rejected_drafts ?? 0} Drafts rejected, integrity recheck queued`);
      } else {
        toast.warning(`${title}: ${res?.reason ?? "no-op"}`);
      }
      qc.invalidateQueries({ queryKey: ["admin", "stale-drafts-detection"] });
    } catch (e: any) {
      toast.error(`Heal failed: ${e.message}`);
    } finally {
      setHealing(null);
    }
  }

  const rows = data ?? [];
  const healCount = rows.filter((r) => r.stale_flag === "STALE_HEAL_NEEDED").length;
  const watchCount = rows.filter((r) => r.stale_flag === "STALE_WATCH").length;

  return (
    <Card className="border-border bg-surface-1">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Stale Drafts Detection
            <Badge variant="outline" className="ml-2 text-xs">SSOT</Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            {healCount > 0 && (
              <Badge variant="destructive">{healCount} heal needed</Badge>
            )}
            {watchCount > 0 && (
              <Badge className="bg-warning/15 text-warning border-warning/30">
                {watchCount} watch
              </Badge>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Pakete mit ≥10 Drafts ohne Step-Fortschritt. „heal needed" = ≥7 Tage stale, 0 aktive Jobs.
          Per-Klick: Drafts &gt; 5 Tage werden rejected + run_integrity_check requeued.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-4">
            ✓ Keine stale Drafts erkannt
          </div>
        ) : (
          <ScrollArea className="h-[320px]">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground sticky top-0 bg-surface-1">
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-2">Paket</th>
                  <th className="text-left py-2 px-2">Track</th>
                  <th className="text-right py-2 px-2">Drafts</th>
                  <th className="text-right py-2 px-2">Approved</th>
                  <th className="text-right py-2 px-2">Step age (d)</th>
                  <th className="text-left py-2 px-2">Flag</th>
                  <th className="text-right py-2 px-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.package_id} className="border-b border-border/50 hover:bg-surface-2/50">
                    <td className="py-2 px-2 max-w-[260px] truncate" title={r.title}>
                      {r.title}
                      <div className="text-xs text-muted-foreground">{r.status}</div>
                    </td>
                    <td className="py-2 px-2 text-xs text-muted-foreground">{r.track}</td>
                    <td className="py-2 px-2 text-right font-mono">{r.drafts}</td>
                    <td className="py-2 px-2 text-right font-mono">{r.approved}</td>
                    <td className="py-2 px-2 text-right font-mono">{r.step_age_days ?? "—"}</td>
                    <td className="py-2 px-2">{flagBadge(r.stale_flag)}</td>
                    <td className="py-2 px-2 text-right">
                      <Button
                        size="sm"
                        variant={r.stale_flag === "STALE_HEAL_NEEDED" ? "default" : "outline"}
                        onClick={() => heal(r.package_id, r.title)}
                        disabled={healing === r.package_id || r.active_jobs > 0}
                        title={r.active_jobs > 0 ? "Active jobs running — wait" : "Reject stale drafts + integrity recheck"}
                      >
                        <Wand2 className="h-3.5 w-3.5 mr-1" />
                        {healing === r.package_id ? "..." : "Heal"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
