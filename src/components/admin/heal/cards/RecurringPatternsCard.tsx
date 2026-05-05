/**
 * RecurringPatternsCard — wiederkehrende Heal-Cluster mit AI-Empfehlung
 * ─────────────────────────────────────────────────────────────────────
 * Zeigt Top-N Pattern aus admin_heal_next_best_action mit Severity, Eskalation,
 * Heal-Historie und einem AI-Analyse-Button (heal-recommend Edge-Function).
 *
 * Persistierte Empfehlung wird inline gerendert. Admin kann Pattern als
 * gelöst markieren oder verwerfen.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Brain, CheckCircle2, ChevronDown, ExternalLink, Flame,
  Loader2, Play, Sparkles, TrendingUp, Wrench, X,
} from "lucide-react";
import { toast } from "sonner";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Link } from "react-router-dom";

type NextBestAction = {
  pattern_key: string;
  cluster: string;
  target_id: string;
  package_id: string | null;
  package_title: string | null;
  package_status: string | null;
  severity_score: number;
  recurrence_24h: number;
  escalation_rate_pct: number;
  blocked_reason: string | null;
  package_last_error: string | null;
  dominant_error: string | null;
  active_recommendation_id: string | null;
  recommendation_confidence: number | null;
  recommendation_root_cause: string | null;
  recommendation_permanent_fix: string | null;
  has_active_recommendation: boolean;
  prior_heal_attempts: number;
};

type HealPlan = {
  steps?: Array<{ action: string; why: string; params?: Record<string, unknown> }>;
  expected_outcome?: string;
};

type FullRecommendation = {
  id: string;
  root_cause: string;
  heal_plan: HealPlan;
  permanent_fix_suggestion: string | null;
  confidence: number | null;
  model: string | null;
  valid_until: string;
};

function severityTone(score: number): "ok" | "warn" | "bad" {
  if (score >= 70) return "bad";
  if (score >= 40) return "warn";
  return "ok";
}

export function RecurringPatternsCard({ limit = 10 }: { limit?: number }) {
  const qc = useQueryClient();
  const { data, isLoading, error: queryError, refetch } = useQuery({
    queryKey: ["heal-recurring-patterns", limit],
    queryFn: async (): Promise<NextBestAction[]> => {
      const { data, error } = await supabase.rpc(
        "admin_heal_next_best_action" as never,
        { p_limit: limit } as never,
      );
      if (error) {
        console.error("[RecurringPatternsCard] RPC error:", error);
        throw error;
      }
      console.info("[RecurringPatternsCard] loaded", (data as unknown[] | null)?.length ?? 0, "patterns");
      return (data ?? []) as unknown as NextBestAction[];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });

  const aiMutation = useMutation({
    mutationFn: async ({ pattern_key, force }: { pattern_key: string; force?: boolean }) => {
      const { data, error } = await supabase.functions.invoke("heal-recommend", {
        body: { pattern_key, force: !!force },
      });
      // FunctionsHttpError: try to read body for the actual error message
      if (error) {
        let detail = error.message;
        try {
          const ctx = (error as { context?: Response }).context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            if (body?.error) detail = `${body.error}${body.detail ? `: ${body.detail}` : ""}`;
          }
        } catch { /* ignore */ }
        console.error("[heal-recommend] invoke error:", error, "detail=", detail);
        throw new Error(detail);
      }
      if ((data as { error?: string })?.error) {
        const d = data as { error: string; detail?: string };
        throw new Error(`${d.error}${d.detail ? `: ${d.detail}` : ""}`);
      }
      return data as { ok: boolean; cached: boolean; recommendation: FullRecommendation };
    },
    onSuccess: (res) => {
      const conf = res?.recommendation?.confidence ?? 0;
      toast.success(
        res?.cached ? "Vorhandene AI-Empfehlung geladen" : "AI-Empfehlung erstellt",
        { description: `Konfidenz ${Math.round(conf * 100)}%` },
      );
      qc.invalidateQueries({ queryKey: ["heal-recurring-patterns"] });
    },
    onError: (e: Error) => {
      const msg = e?.message ?? "unknown_error";
      const friendly =
        msg === "rate_limited"
          ? "AI-Limit erreicht — bitte später erneut versuchen."
          : msg === "payment_required"
            ? "AI-Credits aufgebraucht — bitte aufladen."
            : msg;
      toast.error("AI-Empfehlung fehlgeschlagen", { description: friendly });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ id, note }: { id: string; note?: string }) => {
      const { data, error } = await supabase.rpc(
        "admin_heal_pattern_mark_resolved" as never,
        { p_pattern_id: id, p_note: note ?? null } as never,
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Pattern als gelöst markiert");
      qc.invalidateQueries({ queryKey: ["heal-recurring-patterns"] });
    },
    onError: (e: Error) =>
      toast.error("Konnte nicht markiert werden", { description: e.message }),
  });

  const dismissMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const { data, error } = await supabase.rpc(
        "admin_heal_pattern_dismiss" as never,
        { p_pattern_id: id, p_reason: reason ?? null } as never,
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Empfehlung verworfen");
      qc.invalidateQueries({ queryKey: ["heal-recurring-patterns"] });
    },
    onError: (e: Error) =>
      toast.error("Konnte nicht verworfen werden", { description: e.message }),
  });

  // Snooze (works even when no active recommendation exists — pattern comes from auto_heal_log directly)
  const snoozeMutation = useMutation({
    mutationFn: async ({ cluster, target_id, hours, note }: { cluster: string; target_id: string; hours?: number; note?: string }) => {
      const { data, error } = await supabase.rpc(
        "admin_heal_pattern_snooze" as never,
        { p_cluster: cluster, p_target_id: target_id, p_hours: hours ?? 168, p_note: note ?? null } as never,
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Pattern gesnoozt (7 Tage) — verschwindet aus der Liste");
      qc.invalidateQueries({ queryKey: ["heal-recurring-patterns"] });
    },
    onError: (e: Error) =>
      toast.error("Snooze fehlgeschlagen", { description: e.message }),
  });

  const applyMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { data, error } = await supabase.rpc(
        "admin_heal_apply_recommendation" as never,
        { p_recommendation_id: id } as never,
      );
      if (error) throw error;
      const d = data as { error?: string; ok?: boolean; executed?: number; failed?: number; steps?: unknown[] };
      if (d?.error) throw new Error(d.error);
      return d as { ok: boolean; executed: number; failed: number; steps: unknown[] };
    },
    onSuccess: (res) => {
      const failed = res.failed ?? 0;
      if (failed > 0) {
        toast.warning("Heal-Plan teilweise ausgeführt", {
          description: `${res.executed} ok · ${failed} fehlgeschlagen`,
        });
      } else {
        toast.success("Heal-Plan ausgeführt", {
          description: `${res.executed} Schritt(e) erfolgreich`,
        });
      }
      qc.invalidateQueries({ queryKey: ["heal-recurring-patterns"] });
    },
    onError: (e: Error) =>
      toast.error("Heal-Plan konnte nicht ausgeführt werden", { description: e.message }),
  });

  const createTaskMutation = useMutation({
    mutationFn: async ({ id, priority }: { id: string; priority?: string }) => {
      const { data, error } = await supabase.rpc(
        "admin_create_permanent_fix_task" as never,
        { p_recommendation_id: id, p_priority: priority ?? "medium" } as never,
      );
      if (error) throw error;
      const d = data as { error?: string; ok?: boolean; task_id?: string; reused?: boolean };
      if (d?.error) throw new Error(d.error);
      return d;
    },
    onSuccess: (res) => {
      toast.success(
        res.reused
          ? "Vorhandene Permanent-Fix-Aufgabe geöffnet"
          : "Permanent-Fix als Aufgabe gespeichert",
        { description: "Sichtbar im Backlog oben im Heal-Hub." },
      );
      qc.invalidateQueries({ queryKey: ["heal-permanent-fix-tasks"] });
    },
    onError: (e: Error) =>
      toast.error("Aufgabe konnte nicht erstellt werden", { description: e.message }),
  });


  return (
    <Card className="border-amber-500/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          Wiederkehrende Cluster · AI-Pattern-Detection
          {data && data.length > 0 && (
            <Badge variant="secondary" className="ml-1">{data.length}</Badge>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Pattern aus auto_heal_log (7d). „AI analysieren" liefert Root-Cause + Heal-Plan + Permanent-Fix-Vorschlag.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : queryError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive-bg-subtle p-3 text-sm space-y-2">
            <div className="font-medium text-destructive">
              Pattern konnten nicht geladen werden
            </div>
            <div className="text-xs text-muted-foreground font-mono break-all">
              {(queryError as Error).message}
            </div>
            <div className="text-xs text-muted-foreground">
              Hinweis: Diese Karte erfordert Admin-Rechte (RPC <code>admin_heal_next_best_action</code>).
            </div>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Erneut versuchen
            </Button>
          </div>
        ) : !data || data.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            ✓ Keine wiederkehrenden Cluster über Schwellwert.
          </div>
        ) : (
          data.map((p) => (
            <PatternRow
              key={p.pattern_key}
              p={p}
              onAnalyze={(force) =>
                aiMutation.mutate({ pattern_key: p.pattern_key, force })
              }
              onResolve={(note) =>
                p.active_recommendation_id
                  ? resolveMutation.mutate({ id: p.active_recommendation_id, note })
                  : snoozeMutation.mutate({ cluster: p.cluster, target_id: p.target_id, note: note ?? "resolved from cockpit (no recommendation)" })
              }
              onDismiss={(reason) =>
                p.active_recommendation_id
                  ? dismissMutation.mutate({ id: p.active_recommendation_id, reason })
                  : snoozeMutation.mutate({ cluster: p.cluster, target_id: p.target_id, note: reason ?? "dismissed from cockpit (no recommendation)" })
              }
              onApply={() =>
                p.active_recommendation_id &&
                applyMutation.mutate({ id: p.active_recommendation_id })
              }
              onCreateTask={(priority) =>
                p.active_recommendation_id &&
                createTaskMutation.mutate({ id: p.active_recommendation_id, priority })
              }
              isAnalyzing={
                aiMutation.isPending &&
                aiMutation.variables?.pattern_key === p.pattern_key
              }
              isApplying={
                applyMutation.isPending &&
                applyMutation.variables?.id === p.active_recommendation_id
              }
              isCreatingTask={
                createTaskMutation.isPending &&
                createTaskMutation.variables?.id === p.active_recommendation_id
              }
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function PatternRow({
  p, onAnalyze, onResolve, onDismiss, onApply, onCreateTask,
  isAnalyzing, isApplying, isCreatingTask,
}: {
  p: NextBestAction;
  onAnalyze: (force?: boolean) => void;
  onResolve: (note?: string) => void;
  onDismiss: (reason?: string) => void;
  onApply: () => void;
  onCreateTask: (priority?: string) => void;
  isAnalyzing: boolean;
  isApplying: boolean;
  isCreatingTask: boolean;
}) {
  const [open, setOpen] = useState(false);
  const tone = severityTone(p.severity_score);
  const toneClass =
    tone === "bad"
      ? "border-destructive/40"
      : tone === "warn"
        ? "border-amber-500/40"
        : "border-border";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className={`rounded-md border ${toneClass} bg-muted/20 p-3 space-y-2`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="font-mono text-[10px]">
                {p.cluster}
              </Badge>
              <Badge
                variant={tone === "bad" ? "destructive" : "secondary"}
                className="gap-1"
              >
                <Flame className="h-3 w-3" />
                Severity {p.severity_score}
              </Badge>
              {p.escalation_rate_pct > 60 && (
                <Badge variant="outline" className="gap-1 border-orange-500/50 text-orange-600 dark:text-orange-400">
                  <TrendingUp className="h-3 w-3" />
                  +{p.escalation_rate_pct}% 24h-Anteil
                </Badge>
              )}
              {p.has_active_recommendation && (
                <Badge variant="outline" className="gap-1 border-primary/50 text-primary">
                  <Sparkles className="h-3 w-3" />
                  AI {Math.round((p.recommendation_confidence ?? 0) * 100)}%
                </Badge>
              )}
            </div>
            <div className="text-sm font-medium truncate">
              {p.package_title ?? <span className="text-muted-foreground italic">kein Paket-Titel</span>}
            </div>
            <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
              <span>{p.recurrence_24h} Events / 24h</span>
              <span>{p.prior_heal_attempts} Heals / 7d</span>
              {p.package_status && <span>Status: {p.package_status}</span>}
              {p.blocked_reason && <span className="text-destructive">⚠ {p.blocked_reason}</span>}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 items-end">
            <Button
              size="sm"
              variant={p.has_active_recommendation ? "outline" : "default"}
              disabled={isAnalyzing}
              onClick={() => onAnalyze(p.has_active_recommendation)}
              className="gap-1.5"
            >
              {isAnalyzing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Brain className="h-3.5 w-3.5" />
              )}
              {p.has_active_recommendation ? "Neu analysieren" : "AI analysieren"}
            </Button>
            {p.package_id && (
              <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                <Link to={`/admin/studio/${p.package_id}`}>
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Studio
                </Link>
              </Button>
            )}
          </div>
        </div>

        {p.has_active_recommendation && (
          <div className="rounded border bg-background p-2.5 space-y-2 text-sm">
            <div className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div className="space-y-1 min-w-0 flex-1">
                <div className="text-xs font-medium text-muted-foreground">Root-Cause (AI)</div>
                <div>{p.recommendation_root_cause}</div>
              </div>
            </div>
            {p.recommendation_permanent_fix && (
              <div className="flex items-start gap-2 border-t pt-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-xs font-medium text-muted-foreground">Permanent-Fix-Vorschlag</div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={isCreatingTask}
                      onClick={() => onCreateTask("medium")}
                    >
                      {isCreatingTask ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Wrench className="h-3 w-3 mr-1" />
                      )}
                      In Backlog speichern
                    </Button>
                  </div>
                  <div className="text-xs">{p.recommendation_permanent_fix}</div>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 pt-1 border-t flex-wrap">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs gap-1"
                    disabled={isApplying}
                  >
                    {isApplying ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                    Heal-Plan jetzt ausführen
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Heal-Plan ausführen?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Der KI-vorgeschlagene Heal-Plan wird sofort ausgeführt. Mögliche Aktionen:
                      soft_reentry, hard_heal, mark_content_gap, force_depublish_rebuild.
                      Destruktive Schritte (Depublish + Rebuild) werden direkt angewendet, wenn die KI sie vorgeschlagen hat.
                      Audit-Eintrag in <code>auto_heal_log</code> wird geschrieben.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onApply()}>
                      Ja, ausführen
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => onResolve("acknowledged from cockpit")}
              >
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Als gelöst markieren
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => onDismiss("not relevant")}
              >
                <X className="h-3 w-3 mr-1" />
                Verwerfen
              </Button>
            </div>
          </div>
        )}

        {!p.has_active_recommendation && (
          <div className="flex items-center gap-2 pt-1 border-t flex-wrap">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => onResolve("acknowledged from cockpit (no recommendation)")}
            >
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Als gelöst markieren
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => onDismiss("not relevant (no recommendation)")}
            >
              <X className="h-3 w-3 mr-1" />
              Verwerfen
            </Button>
          </div>
        )}

        {(p.dominant_error || p.package_last_error) && (
          <CollapsibleTrigger asChild>
            <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
              <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
              {open ? "Weniger" : "Fehlerdetails"}
            </button>
          </CollapsibleTrigger>
        )}
        <CollapsibleContent className="space-y-1">
          {p.dominant_error && (
            <div className="text-xs">
              <span className="font-medium text-muted-foreground">Häufigster Fehler:</span>{" "}
              <code className="text-[11px]">{p.dominant_error}</code>
            </div>
          )}
          {p.package_last_error && (
            <div className="text-xs">
              <span className="font-medium text-muted-foreground">Paket-Last-Error:</span>{" "}
              <code className="text-[11px]">{p.package_last_error}</code>
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
