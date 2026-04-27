/**
 * TargetedHealCard — Targeted Heal v1
 *
 * Diagnostiziert + heilt nachhaltig zwei chronische Pipeline-Probleme:
 *   1. Promote-Hotloop: Pakete deren `package_promote_blueprint_variants` Jobs in
 *      Endlosschleifen hängen (≥8 Versuche) → cancel + reseed via fresh
 *      generate_blueprint_variants Job.
 *   2. Hollow-Published: Pakete die "published" sind, aber 0 approved exam_question_variants
 *      haben → admin_force_depublish_and_rebuild.
 *
 * Beide Aktionen: Dry-Run Default, Server-side Admin-Guard, Audit in admin_actions.
 */
import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { AlertTriangle, Activity, Eye, Play, RefreshCw, Stethoscope } from "lucide-react";

type DiagRow = {
  kind: "PROMOTE_HOTLOOP" | "HOLLOW_PUBLISHED" | "STALE_REAPED_RESIDUE";
  packages: number;
  jobs: number;
  max_attempts: number;
};

const KIND_META: Record<DiagRow["kind"], { label: string; tone: "warn" | "danger" | "info"; help: string }> = {
  PROMOTE_HOTLOOP: {
    label: "Promote-Hotloop",
    tone: "danger",
    help: "Pakete mit ≥8 erfolglosen Promote-Versuchen — Variants fehlen oder können nicht freigegeben werden.",
  },
  HOLLOW_PUBLISHED: {
    label: "Hollow-Published",
    tone: "danger",
    help: "Live-Pakete mit 0 approved Fragen — User sehen leere Pools. Bedarf Depublish + Rebuild.",
  },
  STALE_REAPED_RESIDUE: {
    label: "Stale-Reaped Residue",
    tone: "warn",
    help: "Letzte 24h: Jobs vom Reaper terminiert — i.d.R. einmalig, sollte abklingen.",
  },
};

export function TargetedHealCard() {
  const qc = useQueryClient();
  const [hotloopPreview, setHotloopPreview] = useState<unknown>(null);
  const [hollowPreview, setHollowPreview] = useState<unknown>(null);

  const diag = useQuery({
    queryKey: ["targeted-heal-diagnosis"],
    queryFn: async (): Promise<DiagRow[]> => {
      const { data, error } = await supabase
        .from("v_admin_targeted_heal_diagnosis" as never)
        .select("*");
      if (error) throw error;
      return (data as unknown as DiagRow[]) ?? [];
    },
    refetchInterval: 30_000,
  });

  const promoteDry = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_resolve_promote_hotloop" as never, {
        p_dry_run: true,
        p_attempt_threshold: 8,
        p_max_packages: 20,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setHotloopPreview(data);
      toast({ title: "Hotloop Dry-Run", description: "Kandidaten ermittelt — bitte prüfen, dann Execute." });
    },
    onError: (e: Error) => toast({ title: "Dry-Run fehlgeschlagen", description: e.message, variant: "destructive" }),
  });

  const promoteExec = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_resolve_promote_hotloop" as never, {
        p_dry_run: false,
        p_attempt_threshold: 8,
        p_max_packages: 20,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: (data: unknown) => {
      const r = data as { jobs_cancelled?: number; reseeds_enqueued?: number };
      toast({
        title: "Hotloop aufgelöst",
        description: `${r.jobs_cancelled ?? 0} Jobs cancelled · ${r.reseeds_enqueued ?? 0} Variants-Reseeds enqueued`,
      });
      setHotloopPreview(null);
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast({ title: "Execute fehlgeschlagen", description: e.message, variant: "destructive" }),
  });

  const hollowDry = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_bulk_depublish_hollow" as never, {
        p_dry_run: true,
        p_max_packages: 30,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setHollowPreview(data);
      toast({ title: "Hollow Dry-Run", description: "Pakete ermittelt — bitte prüfen, dann Execute." });
    },
    onError: (e: Error) => toast({ title: "Dry-Run fehlgeschlagen", description: e.message, variant: "destructive" }),
  });

  const hollowExec = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_bulk_depublish_hollow" as never, {
        p_dry_run: false,
        p_max_packages: 30,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: (data: unknown) => {
      const r = data as { done?: number; failed?: number };
      toast({
        title: "Hollow-Pakete depubliziert",
        description: `${r.done ?? 0} ok · ${r.failed ?? 0} fehlgeschlagen — Rebuild läuft im Hintergrund.`,
      });
      setHollowPreview(null);
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast({ title: "Execute fehlgeschlagen", description: e.message, variant: "destructive" }),
  });

  const rows = diag.data ?? [];
  const totalPkgs = rows.reduce((s, r) => s + (r.packages ?? 0), 0);

  return (
    <Card className="border-warning/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Stethoscope className="h-4 w-4 text-warning" />
          Targeted Heal — Hotloop &amp; Hollow
          <Badge variant={totalPkgs > 0 ? "destructive" : "secondary"} className="ml-auto tabular-nums">
            {totalPkgs} Pakete betroffen
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Diagnose-Übersicht */}
        {diag.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {(["PROMOTE_HOTLOOP", "HOLLOW_PUBLISHED", "STALE_REAPED_RESIDUE"] as const).map((kind) => {
              const row = rows.find((r) => r.kind === kind) ?? { packages: 0, jobs: 0, max_attempts: 0, kind };
              const meta = KIND_META[kind];
              return (
                <div
                  key={kind}
                  className={`rounded-md border p-3 ${
                    row.packages > 0
                      ? meta.tone === "danger"
                        ? "border-destructive/40 bg-destructive/5"
                        : "border-warning/40 bg-warning/5"
                      : "border-border bg-muted/20"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs font-semibold">{meta.label}</div>
                    <Badge variant="outline" className="tabular-nums text-[10px]">
                      {row.packages} pkg
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-tight">{meta.help}</div>
                  {row.jobs > 0 ? (
                    <div className="text-[10px] mt-1 text-muted-foreground tabular-nums">
                      {row.jobs} Jobs · max {row.max_attempts} Attempts
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {/* Action 1 — Promote-Hotloop */}
        <div className="rounded-md border border-destructive/30 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-destructive" />
            <div className="text-xs font-semibold">Promote-Hotloop auflösen</div>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Cancel ≥8-Attempt Promote-Jobs · Reset Pipeline-Steps · Enqueue frischen Variants-Reseed.
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => promoteDry.mutate()}
              disabled={promoteDry.isPending}
            >
              <Eye className="h-3 w-3 mr-1" />
              Dry-Run
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => promoteExec.mutate()}
              disabled={!hotloopPreview || promoteExec.isPending}
            >
              <Play className="h-3 w-3 mr-1" />
              Execute (Reseed)
            </Button>
          </div>
          {hotloopPreview != null ? (
            <pre className="text-[10px] bg-muted/30 rounded p-2 max-h-32 overflow-auto">
              {JSON.stringify(hotloopPreview, null, 2)}
            </pre>
          ) : null}
        </div>

        {/* Action 2 — Hollow-Published */}
        <div className="rounded-md border border-destructive/30 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            <div className="text-xs font-semibold">Hollow-Published bereinigen</div>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Bulk-Depublish + Rebuild von Live-Paketen mit 0 approved Fragen. Limit 30/Run.
          </div>
          <Alert variant="default" className="py-2">
            <AlertDescription className="text-[11px]">
              Achtung: Pakete verschwinden temporär aus dem Shop bis Rebuild fertig ist (typ. 1–4h).
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => hollowDry.mutate()}
              disabled={hollowDry.isPending}
            >
              <Eye className="h-3 w-3 mr-1" />
              Dry-Run
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => hollowExec.mutate()}
              disabled={!hollowPreview || hollowExec.isPending}
            >
              <Play className="h-3 w-3 mr-1" />
              Execute (Depublish + Rebuild)
            </Button>
          </div>
          {hollowPreview != null ? (
            <pre className="text-[10px] bg-muted/30 rounded p-2 max-h-32 overflow-auto">
              {JSON.stringify(hollowPreview, null, 2)}
            </pre>
          ) : null}
        </div>

        <div className="flex items-center justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => qc.invalidateQueries({ queryKey: ["targeted-heal-diagnosis"] })}
          >
            <RefreshCw className="h-3 w-3 mr-1" /> Diagnose aktualisieren
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
