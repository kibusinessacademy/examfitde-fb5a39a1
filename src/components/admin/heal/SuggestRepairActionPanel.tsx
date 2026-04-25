/**
 * SuggestRepairActionPanel
 * ────────────────────────
 * UI wrapper über RPC `admin_suggest_repair_action` mit:
 *   • Dry-Run Vorschau (root cause, recommended job, risk, validation)
 *   • Apply-Button (enqueued den vorgeschlagenen Repair-Job, dedupliziert)
 *
 * Schließt den Loop zwischen Resolver-Diagnose und Operator-Aktion.
 * Verhindert No-Effect-Loops, weil der Resolver Mode→Job-Type strikt validiert.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Props {
  packageId: string;
}

interface SuggestionResponse {
  suggestion?: {
    strategy?: string;
    job_type?: string | null;
    payload?: Record<string, unknown>;
    reason?: string;
    target_competency_ids?: string[];
    target_lf_ids?: string[];
    total_competencies?: number;
    total_lf?: number;
    total_blueprints?: number;
    approved_questions?: number;
    hardish_pct?: number;
    target_hardish_pct?: number;
  };
  validation?: {
    valid?: boolean;
    warning?: string | null;
    severity?: string;
    job_type?: string;
    mode?: string;
  };
  risk?: "none" | "low" | "medium" | "high";
  duplicate_exists?: boolean;
  applied?: boolean;
  dry_run?: boolean;
  new_job_id?: string;
  message?: string;
  error?: string;
}

function riskBadge(risk?: string) {
  const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    none: { variant: "outline", label: "Kein Risiko" },
    low: { variant: "secondary", label: "Niedrig" },
    medium: { variant: "default", label: "Mittel" },
    high: { variant: "destructive", label: "Hoch" },
  };
  const cfg = map[risk ?? "medium"] ?? map.medium;
  return <Badge variant={cfg.variant}>Risiko: {cfg.label}</Badge>;
}

function strategyBadge(strategy?: string) {
  if (!strategy) return null;
  if (strategy.startsWith("no_action")) {
    return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">{strategy}</Badge>;
  }
  if (strategy === "manual_review_required" || strategy === "forbidden") {
    return <Badge variant="destructive">{strategy}</Badge>;
  }
  return <Badge variant="secondary">{strategy}</Badge>;
}

export function SuggestRepairActionPanel({ packageId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showPayload, setShowPayload] = useState(false);

  // Dry-Run-Vorschau (auto-load + manuelles Refresh)
  const dryRun = useQuery<SuggestionResponse>({
    queryKey: ["suggest-repair-action", packageId, "dry"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_suggest_repair_action", {
        _package_id: packageId,
        _dry_run: true,
      });
      if (error) throw error;
      return (data as SuggestionResponse) ?? {};
    },
    staleTime: 15_000,
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_suggest_repair_action", {
        _package_id: packageId,
        _dry_run: false,
      });
      if (error) throw error;
      return (data as SuggestionResponse) ?? {};
    },
    onSuccess: (res) => {
      if (res.applied && res.new_job_id) {
        toast({
          title: "Repair-Job enqueued",
          description: `Job ${res.new_job_id.slice(0, 8)} (${res.suggestion?.job_type}) wurde geplant.`,
        });
      } else if (res.duplicate_exists) {
        toast({
          title: "Job läuft bereits",
          description: "Ein aktiver Repair-Job für diese Strategie existiert.",
          variant: "default",
        });
      } else if (res.validation && res.validation.valid === false) {
        toast({
          title: "Validation blockiert",
          description: res.validation.warning ?? "Job-Type/Mode-Mismatch.",
          variant: "destructive",
        });
      } else if (!res.suggestion?.job_type) {
        toast({
          title: "Keine Aktion nötig",
          description: res.message ?? res.suggestion?.reason ?? "no_action",
        });
      } else {
        toast({
          title: "Nicht angewendet",
          description: "Bitte Validierung prüfen.",
          variant: "destructive",
        });
      }
      qc.invalidateQueries({ queryKey: ["suggest-repair-action", packageId] });
      qc.invalidateQueries({ queryKey: ["package-live-jobs", packageId] });
      qc.invalidateQueries({ queryKey: ["heal-cockpit"] });
    },
    onError: (e: unknown) => {
      toast({
        title: "RPC-Fehler",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  const data = dryRun.data;
  const sug = data?.suggestion;
  const val = data?.validation;
  const isLoading = dryRun.isLoading;
  const noAction = !sug?.job_type;
  const validBlocked = val && val.valid === false;
  const dupBlocked = !!data?.duplicate_exists;
  const canApply = !!sug?.job_type && !validBlocked && !dupBlocked && !applyMutation.isPending;

  return (
    <Card className="border-primary/30">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">Suggest Repair Action</CardTitle>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => dryRun.refetch()}
          disabled={dryRun.isFetching}
        >
          <RefreshCw className={`mr-1.5 h-3 w-3 ${dryRun.isFetching ? "animate-spin" : ""}`} />
          Neu prüfen
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <Skeleton className="h-20 w-full" />}

        {dryRun.error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>RPC-Fehler</AlertTitle>
            <AlertDescription className="font-mono text-xs">
              {dryRun.error instanceof Error ? dryRun.error.message : String(dryRun.error)}
            </AlertDescription>
          </Alert>
        )}

        {data && !isLoading && (
          <>
            {/* Header-Zeile: Strategy + Risk */}
            <div className="flex flex-wrap items-center gap-2">
              {strategyBadge(sug?.strategy)}
              {riskBadge(data.risk)}
              {sug?.job_type && (
                <Badge variant="outline" className="font-mono text-[10px]">
                  {sug.job_type}
                </Badge>
              )}
              {sug?.payload && typeof (sug.payload as Record<string, unknown>).mode === "string" && (
                <Badge variant="outline" className="font-mono text-[10px]">
                  mode: {String((sug.payload as Record<string, unknown>).mode)}
                </Badge>
              )}
            </div>

            {/* Root cause / reason */}
            {sug?.reason && (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
                <div className="mb-1 font-semibold uppercase text-muted-foreground">
                  Root Cause
                </div>
                <div className="font-mono">{sug.reason}</div>
              </div>
            )}

            {/* Coverage-Stats */}
            {sug && (
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <Stat label="Approved" value={sug.approved_questions ?? 0} />
                <Stat label="LF" value={sug.total_lf ?? 0} />
                <Stat label="Comp." value={sug.total_competencies ?? 0} />
                <Stat
                  label="Hardish %"
                  value={`${(sug.hardish_pct ?? 0).toFixed(1)} / ${sug.target_hardish_pct ?? 0}`}
                />
              </div>
            )}

            {/* Targets */}
            {((sug?.target_lf_ids?.length ?? 0) > 0 || (sug?.target_competency_ids?.length ?? 0) > 0) && (
              <div className="grid gap-2 text-xs sm:grid-cols-2">
                {(sug?.target_lf_ids?.length ?? 0) > 0 && (
                  <div className="rounded border px-2 py-1">
                    <span className="font-semibold">{sug?.target_lf_ids?.length}</span> fehlende Lernfelder
                  </div>
                )}
                {(sug?.target_competency_ids?.length ?? 0) > 0 && (
                  <div className="rounded border px-2 py-1">
                    <span className="font-semibold">{sug?.target_competency_ids?.length}</span> Kompetenzen mit zu wenig Fragen
                  </div>
                )}
              </div>
            )}

            {/* Validation warning */}
            {val?.warning && (
              <Alert variant={validBlocked ? "destructive" : "default"}>
                {validBlocked ? <ShieldAlert className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                <AlertTitle>{validBlocked ? "Validierung blockiert Apply" : "Hinweis"}</AlertTitle>
                <AlertDescription className="text-xs">{val.warning}</AlertDescription>
              </Alert>
            )}

            {/* Duplicate */}
            {dupBlocked && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Aktiver Job vorhanden</AlertTitle>
                <AlertDescription className="text-xs">
                  Ein passender Repair-Job läuft bereits (oder ist eingeplant). Apply ist deaktiviert.
                </AlertDescription>
              </Alert>
            )}

            {/* No-action */}
            {noAction && !validBlocked && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Keine Aktion erforderlich</AlertTitle>
                <AlertDescription className="text-xs">
                  {data.message ?? sug?.reason ?? "Resolver meldet kein Defizit oder verlangt manuelles Review."}
                </AlertDescription>
              </Alert>
            )}

            {/* Apply-Button */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => applyMutation.mutate()}
                disabled={!canApply}
              >
                {applyMutation.isPending ? (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                ) : (
                  <PlayCircle className="mr-1.5 h-3 w-3" />
                )}
                Apply suggested fix
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowPayload((v) => !v)}
              >
                {showPayload ? "Payload ausblenden" : "Payload zeigen"}
              </Button>
            </div>

            {showPayload && sug && (
              <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-[10px] leading-tight">
                {JSON.stringify({ job_type: sug.job_type, payload: sug.payload, validation: val }, null, 2)}
              </pre>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border bg-card px-2 py-1.5">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}
