/**
 * BlockedPackagesCard — Diagnose & Bulk-Unblock von blocked Paketen.
 *
 * Heilt KI-Gap "Keine detaillierten Informationen zu blocked Paketen":
 *  - Liest v_admin_blocked_packages_diagnosis (Aggregation nach Block-Reason).
 *  - Pro Reason-Class: Dry-Run + Bulk-Unblock via admin_unblock_packages_by_reason.
 *
 * Strategien je Reason:
 *  - HARD_FAIL_NO_CURRICULUM → status=queued (vorsichtig, Curriculum fehlt)
 *  - COVERAGE_GAP            → status=building, reset auto_publish step
 *  - NON_BUILDING_BLOCKED    → status=building, reset alle failed steps
 *  - AUTO_HEALED_RESIDUE     → status=building, reset alle
 *  - NO_STEP_HISTORY         → status=building, reset alle
 *  - HARD_FAIL_OTHER         → status=queued
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertOctagon, ChevronRight, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

interface DiagnosisRow {
  reason_class: string;
  package_count: number;
  oldest_blocked_at: string | null;
  newest_blocked_at: string | null;
  package_ids: string[];
  sample_titles: string[];
  dominant_step: string | null;
  sample_error: string | null;
}

const REASON_LABELS: Record<string, { label: string; tone: "destructive" | "warning" | "secondary" }> = {
  HARD_FAIL_NO_CURRICULUM: { label: "Curriculum fehlt", tone: "destructive" },
  COVERAGE_GAP: { label: "Coverage-Gap", tone: "warning" },
  NON_BUILDING_BLOCKED: { label: "Non-Building-Blocked", tone: "warning" },
  HARD_FAIL_OTHER: { label: "Hard-Fail (Sonstige)", tone: "destructive" },
  AUTO_HEALED_RESIDUE: { label: "Auto-Heal-Residue", tone: "secondary" },
  NO_STEP_HISTORY: { label: "Keine Step-Historie", tone: "secondary" },
  OTHER: { label: "Andere", tone: "secondary" },
};

export function BlockedPackagesCard() {
  const qc = useQueryClient();
  const [maxPackages, setMaxPackages] = useState<number>(25);
  const [previews, setPreviews] = useState<Record<string, number | null>>({});

  const { data: rows, isLoading, refetch } = useQuery({
    queryKey: ["blocked-packages-diagnosis"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_admin_blocked_packages_diagnosis")
        .select("*");
      if (error) throw error;
      return (data ?? []) as DiagnosisRow[];
    },
    refetchInterval: 30_000,
  });

  const unblockMutation = useMutation({
    mutationFn: async (params: { reason: string; dryRun: boolean }) => {
      const { data, error } = await supabase.rpc("admin_unblock_packages_by_reason" as any, {
        p_reason_class: params.reason,
        p_max_packages: maxPackages,
        p_dry_run: params.dryRun,
      });
      if (error) throw error;
      return { data: data as any, ...params };
    },
    onSuccess: ({ data, reason, dryRun }) => {
      if (dryRun) {
        setPreviews((p) => ({ ...p, [reason]: data?.candidate_count ?? 0 }));
        toast.message(`Dry-Run: ${data?.candidate_count ?? 0} Pakete`, {
          description: `Ziel-Status: ${data?.target_status} · Reset-Step: ${data?.reset_step ?? "ALLE failed"}`,
        });
      } else {
        toast.success(
          `${data?.unblocked ?? 0} Pakete entblockt · ${data?.steps_reset ?? 0} Steps zurückgesetzt`,
        );
        setPreviews((p) => ({ ...p, [reason]: null }));
        refetch();
        qc.invalidateQueries({ queryKey: ["blocker-counts"] });
        qc.invalidateQueries({ queryKey: ["targeted-heal-diagnosis"] });
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Unblock fehlgeschlagen"),
  });

  const totalBlocked = (rows ?? []).reduce((sum, r) => sum + r.package_count, 0);

  return (
    <Card className="p-4 border-destructive/30" data-testid="blocked-packages-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertOctagon className="h-4 w-4 text-destructive" />
          <h3 className="text-sm font-semibold">Blocked-Pakete: Bulk-Unblock nach Grund</h3>
          <Badge variant="destructive" className="text-[10px]">{totalBlocked} blocked</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="max-pkgs" className="text-[10px] text-muted-foreground">
            Max Pakete/Bulk
          </Label>
          <Input
            id="max-pkgs"
            type="number"
            min={1}
            max={100}
            value={maxPackages}
            onChange={(e) => setMaxPackages(Math.max(1, Number(e.target.value) || 25))}
            className="h-7 w-16 text-xs"
          />
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
          <Loader2 className="h-3 w-3 mr-2 animate-spin" /> Lade Diagnose…
        </div>
      )}

      {!isLoading && (rows ?? []).length === 0 && (
        <div className="text-center py-6 text-xs text-muted-foreground">
          <ShieldCheck className="h-5 w-5 mx-auto mb-1 text-success" />
          Keine blocked Pakete — alles im grünen Bereich.
        </div>
      )}

      <div className="space-y-2">
        {(rows ?? []).map((row) => {
          const meta = REASON_LABELS[row.reason_class] ?? REASON_LABELS.OTHER;
          const preview = previews[row.reason_class];
          const isPending = unblockMutation.isPending && unblockMutation.variables?.reason === row.reason_class;
          return (
            <div
              key={row.reason_class}
              className="flex items-start justify-between gap-3 p-2.5 rounded border border-border/60 bg-card/40 hover:bg-card transition-colors"
              data-testid={`blocked-row-${row.reason_class}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={meta.tone === "destructive" ? "destructive" : "secondary"} className="text-[10px]">
                    {meta.label}
                  </Badge>
                  <span className="text-xs font-semibold">{row.package_count} Pakete</span>
                  {row.dominant_step && (
                    <span className="text-[10px] text-muted-foreground font-mono">→ {row.dominant_step}</span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground line-clamp-1">
                  {row.sample_titles.slice(0, 3).join(" · ")}
                </div>
                {row.sample_error && (
                  <div className="text-[10px] text-destructive/70 line-clamp-1 font-mono mt-0.5">
                    {row.sample_error.substring(0, 110)}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1 shrink-0 items-end">
                {preview !== null && preview !== undefined && (
                  <Badge variant="outline" className="text-[10px]">
                    {preview} Kandidaten
                  </Badge>
                )}
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[10px] px-2"
                    disabled={isPending}
                    onClick={() => unblockMutation.mutate({ reason: row.reason_class, dryRun: true })}
                    data-testid={`unblock-dry-run-${row.reason_class}`}
                  >
                    Dry-Run
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-[10px] px-2"
                    disabled={isPending || preview == null || preview === 0}
                    onClick={() => unblockMutation.mutate({ reason: row.reason_class, dryRun: false })}
                    data-testid={`unblock-execute-${row.reason_class}`}
                  >
                    {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <>Unblock <ChevronRight className="h-3 w-3" /></>}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
