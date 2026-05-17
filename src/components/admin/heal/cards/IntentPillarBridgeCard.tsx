/**
 * A1 Intent → Cert-Pillar Bridge Card (Heal Cockpit)
 * ──────────────────────────────────────────────────
 * Liest v_intent_to_cert_pillar_bridge_candidates via Summary-RPC,
 * dispatcht admin_seo_bridge_intent_to_cert_pillar (dry-run / live).
 * Live verlangt Reason-Pflichtfeld (≥5 chars). Beidseitige Inserts
 * werden vom Dispatch als 'suggested' angelegt — Materialisierung
 * läuft anschließend über E3c (InternalLinkMaterializationCard).
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Link2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type SummaryRow = {
  decision: string;
  pair_count: number;
  distinct_pillars: number;
  distinct_intents: number;
};

const QK = ["a1-intent-pillar-bridge-summary"] as const;

export function IntentPillarBridgeCard() {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [limit, setLimit] = useState(25);

  const { data, isLoading, error } = useQuery({
    queryKey: QK,
    queryFn: async (): Promise<SummaryRow[]> => {
      const { data, error } = await supabase.rpc("admin_get_intent_pillar_bridge_summary");
      if (error) throw error;
      return (data ?? []) as SummaryRow[];
    },
    staleTime: 30_000,
    refetchInterval: 120_000,
  });

  const ready = data?.find((r) => r.decision === "READY_TO_BRIDGE");
  const linked = data?.find((r) => r.decision === "ALREADY_LINKED");
  const unrouted = data?.find((r) => r.decision === "UNROUTED_CATALOG_TYPE");
  const readyCount = ready?.pair_count ?? 0;
  const readyPillars = ready?.distinct_pillars ?? 0;

  const dispatch = useMutation({
    mutationFn: async ({ dry }: { dry: boolean }) => {
      const { data, error } = await supabase.rpc("admin_seo_bridge_intent_to_cert_pillar", {
        p_limit: limit,
        p_dry_run: dry,
        p_reason: dry ? undefined : reason.trim(),
      });
      if (error) throw error;
      return data as {
        ok: boolean;
        dry_run: boolean;
        eligible_pairs: number;
        inserted: number;
        skipped: number;
      };
    },
    onSuccess: (res) => {
      toast.success(
        res.dry_run
          ? `Dry-Run OK — ${res.eligible_pairs} eligible, ${res.skipped} would be written.`
          : `Live OK — ${res.inserted} suggestions inserted, ${res.skipped} skipped.`,
      );
      qc.invalidateQueries({ queryKey: QK });
      qc.invalidateQueries({ queryKey: ["e3c-materialization-summary"] });
      setReason("");
    },
    onError: (e: unknown) => {
      toast.error(`Bridge failed: ${e instanceof Error ? e.message : String(e)}`);
    },
  });

  const liveDisabled = reason.trim().length < 5 || readyCount === 0 || dispatch.isPending;
  const severity: "ok" | "warn" | "crit" = readyCount === 0 ? "ok" : readyCount > 40 ? "warn" : "ok";

  return (
    <Card className="border-border">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 className="h-4 w-4" />
              A1 Intent → Cert-Pillar Bridge
            </CardTitle>
            <CardDescription className="mt-1">
              Verknüpft veröffentlichte Intent-Spokes (Quality ≥ 80) mit ihren Cert-Pillars
              (beidseitig). Status: <code className="text-xs">suggested</code> → E3c
              materialisiert.
            </CardDescription>
          </div>
          <Badge variant={severity === "ok" ? "secondary" : "outline"}>
            {severity === "ok" ? "OK" : "WARN"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lade Bridge-Status…
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {(error as Error).message}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Metric label="Ready to bridge" value={readyCount} accent />
          <Metric label="Distinct pillars" value={readyPillars} />
          <Metric label="Already linked" value={linked?.pair_count ?? 0} />
          <Metric label="Unrouted catalog" value={unrouted?.pair_count ?? 0} muted />
        </div>

        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="a1-limit" className="text-xs">
                Cap (max 100)
              </Label>
              <Input
                id="a1-limit"
                type="number"
                min={1}
                max={100}
                value={limit}
                onChange={(e) =>
                  setLimit(Math.max(1, Math.min(100, Number(e.target.value) || 25)))
                }
              />
            </div>
            <div>
              <Label htmlFor="a1-reason" className="text-xs">
                Reason (≥5 chars, Live-Pflicht)
              </Label>
              <Input
                id="a1-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="A1 wave run …"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => dispatch.mutate({ dry: true })}
              disabled={dispatch.isPending || readyCount === 0}
            >
              {dispatch.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : null}
              Dry-Run
            </Button>
            <Button
              size="sm"
              onClick={() => dispatch.mutate({ dry: false })}
              disabled={liveDisabled}
              title={
                reason.trim().length < 5
                  ? "Reason ≥5 chars erforderlich"
                  : readyCount === 0
                    ? "Keine eligible Pairs"
                    : "Live ausführen"
              }
            >
              {dispatch.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : null}
              Live Apply
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Schreibt je Pair 2 Rows (cluster_to_pillar + pillar_to_cluster) als{" "}
            <code>suggested</code>. Aktivierung erfolgt über die E3c-Materialisierungs-Card.
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
