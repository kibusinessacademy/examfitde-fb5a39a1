/**
 * PillarCoverageCard — Phase A Heal-Cockpit
 * ─────────────────────────────────────────
 * Liest admin_get_pillar_coverage_summary (jsonb) und zeigt
 * - Published-Pakete ohne Pillar (PF/PV)
 * - Pillar-Orphans (kein source_package_id)
 * - Backfill-Dispatcher (dry-run / live, Reason-Pflicht ≥5)
 * - Manual-Dispatch per package_id
 *
 * Mutationen schreiben Audit via SECURITY DEFINER RPCs.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, FileText, AlertTriangle, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type CoverageSummary = {
  published_packages?: number;
  pillars_total?: number;
  pillars_linked?: number;
  missing_both?: number;
  missing_pf?: number;
  missing_pv?: number;
  orphans?: number;
  in_backlog?: number;
  [k: string]: unknown;
};

const QK = ["pillar-coverage-summary"] as const;

export function PillarCoverageCard() {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [pkgId, setPkgId] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: QK,
    queryFn: async (): Promise<CoverageSummary> => {
      const { data, error } = await supabase.rpc("admin_get_pillar_coverage_summary");
      if (error) throw error;
      return (data ?? {}) as CoverageSummary;
    },
    staleTime: 30_000,
    refetchInterval: 120_000,
  });

  const backfill = useMutation({
    mutationFn: async ({ dry }: { dry: boolean }) => {
      const { data, error } = await supabase.rpc(
        "admin_backfill_pillar_source_package_id",
        { _dry_run: dry },
      );
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: (res, vars) => {
      toast.success(
        vars.dry
          ? `Dry-Run OK — ${JSON.stringify(res).slice(0, 200)}`
          : `Live OK — Backfill ausgeführt.`,
      );
      qc.invalidateQueries({ queryKey: QK });
      setReason("");
    },
    onError: (e: unknown) =>
      toast.error(`Backfill fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`),
  });

  const dispatchOne = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc(
        "admin_dispatch_pillar_ensure_for_package",
        { _package_id: id },
      );
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: (res) => {
      toast.success(`Dispatched — ${JSON.stringify(res).slice(0, 200)}`);
      qc.invalidateQueries({ queryKey: QK });
      setPkgId("");
    },
    onError: (e: unknown) =>
      toast.error(`Dispatch fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`),
  });

  const missingBoth = Number(data?.missing_both ?? 0);
  const missingPf = Number(data?.missing_pf ?? 0);
  const missingPv = Number(data?.missing_pv ?? 0);
  const orphans = Number(data?.orphans ?? 0);
  const linked = Number(data?.pillars_linked ?? 0);
  const total = Number(data?.pillars_total ?? 0);
  const published = Number(data?.published_packages ?? 0);

  const totalMissing = missingBoth + missingPf + missingPv;
  const severity: "ok" | "warn" | "crit" =
    totalMissing > 100 ? "crit" : totalMissing > 20 ? "warn" : "ok";

  const liveDisabled = reason.trim().length < 5 || orphans === 0 || backfill.isPending;
  const dispatchDisabled = !/^[0-9a-f-]{36}$/i.test(pkgId) || dispatchOne.isPending;

  return (
    <Card className="border-border">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" />
              SEO Pillar Coverage (Phase A)
            </CardTitle>
            <CardDescription className="mt-1">
              Published-Pakete ohne PF/PV-Pillar + orphane Pillars ohne{" "}
              <code className="text-xs">source_package_id</code>. Skeleton-Dispatch via
              SSOT-Worker <code className="text-xs">package_seo_pillar_ensure</code>.
            </CardDescription>
          </div>
          <Badge
            variant={severity === "ok" ? "secondary" : severity === "warn" ? "outline" : "destructive"}
          >
            {severity.toUpperCase()}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lade Pillar-Coverage…
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {(error as Error).message}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Metric label="Published" value={published} />
          <Metric label="Pillars total" value={total} />
          <Metric label="Linked (source_pkg)" value={linked} accent={linked > 0} />
          <Metric label="Orphans" value={orphans} muted={orphans === 0} />
          <Metric label="Missing both" value={missingBoth} accent={missingBoth > 0} />
          <Metric label="Missing PF" value={missingPf} />
          <Metric label="Missing PV" value={missingPv} />
          <Metric label="In backlog" value={Number(data?.in_backlog ?? 0)} muted />
        </div>

        {/* Backfill Block */}
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Backfill source_package_id (Orphans)</div>
            <Badge variant="outline">{orphans} orphans</Badge>
          </div>
          <div>
            <Label htmlFor="pillar-reason" className="text-xs">
              Reason (≥5 chars, Live-Pflicht)
            </Label>
            <Input
              id="pillar-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Phase A backfill wave …"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => backfill.mutate({ dry: true })}
              disabled={backfill.isPending || orphans === 0}
            >
              {backfill.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
              Dry-Run
            </Button>
            <Button
              size="sm"
              onClick={() => backfill.mutate({ dry: false })}
              disabled={liveDisabled}
              title={
                reason.trim().length < 5
                  ? "Reason ≥5 chars erforderlich"
                  : orphans === 0
                    ? "Keine Orphans"
                    : "Live ausführen"
              }
            >
              {backfill.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
              Live Backfill
            </Button>
          </div>
        </div>

        {/* Manual Dispatch Block */}
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
          <div className="text-sm font-medium flex items-center gap-2">
            <Wrench className="h-4 w-4" /> Manual Skeleton-Dispatch
          </div>
          <div>
            <Label htmlFor="pillar-pkg" className="text-xs">
              Package UUID
            </Label>
            <Input
              id="pillar-pkg"
              value={pkgId}
              onChange={(e) => setPkgId(e.target.value.trim())}
              placeholder="e.g. 5f942a80-aad2-4988-aa01-ac7baedd9a5e"
              className="font-mono text-xs"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => dispatchOne.mutate(pkgId)}
            disabled={dispatchDisabled}
          >
            {dispatchOne.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
            Dispatch Pillar Ensure
          </Button>
          <p className="text-xs text-muted-foreground">
            Enqueued <code>package_seo_pillar_ensure</code>; Worker ruft idempotente
            Skeleton-RPC. Content bleibt <code>reserved</code> bis Governance.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  accent,
  muted,
}: {
  label: string;
  value: number;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`rounded-md border p-2 ${
        accent
          ? "border-primary/40 bg-primary/5"
          : muted
            ? "border-border bg-muted/20"
            : "border-border bg-card"
      }`}
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value.toLocaleString()}</div>
    </div>
  );
}
