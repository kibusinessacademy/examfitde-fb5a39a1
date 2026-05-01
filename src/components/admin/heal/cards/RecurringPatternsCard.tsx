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
  Loader2, Sparkles, TrendingUp, X,
} from "lucide-react";
import { toast } from "sonner";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Link } from "react-router-dom";

type NextBestAction = {
  pattern_key: string;
  cluster: string;
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
  const { data, isLoading } = useQuery({
    queryKey: ["heal-recurring-patterns", limit],
    queryFn: async (): Promise<NextBestAction[]> => {
      const { data, error } = await supabase.rpc(
        "admin_heal_next_best_action" as never,
        { p_limit: limit } as never,
      );
      if (error) throw error;
      return (data ?? []) as unknown as NextBestAction[];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const aiMutation = useMutation({
    mutationFn: async ({ pattern_key, force }: { pattern_key: string; force?: boolean }) => {
      const { data, error } = await supabase.functions.invoke("heal-recommend", {
        body: { pattern_key, force: !!force },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) {
        throw new Error((data as { error: string }).error);
      }
      return data as { ok: boolean; cached: boolean; recommendation: FullRecommendation };
    },
    onSuccess: (res) => {
      toast.success(
        res.cached ? "Vorhandene AI-Empfehlung geladen" : "AI-Empfehlung erstellt",
        {
          description: `Konfidenz ${(res.recommendation.confidence ?? 0) * 100}%`,
        },
      );
      qc.invalidateQueries({ queryKey: ["heal-recurring-patterns"] });
    },
    onError: (e: Error) => {
      const msg = e.message;
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
                p.active_recommendation_id &&
                resolveMutation.mutate({ id: p.active_recommendation_id, note })
              }
              onDismiss={(reason) =>
                p.active_recommendation_id &&
                dismissMutation.mutate({ id: p.active_recommendation_id, reason })
              }
              isAnalyzing={
                aiMutation.isPending &&
                aiMutation.variables?.pattern_key === p.pattern_key
              }
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function PatternRow({
  p, onAnalyze, onResolve, onDismiss, isAnalyzing,
}: {
  p: NextBestAction;
  onAnalyze: (force?: boolean) => void;
  onResolve: (note?: string) => void;
  onDismiss: (reason?: string) => void;
  isAnalyzing: boolean;
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
                  <div className="text-xs font-medium text-muted-foreground">Permanent-Fix-Vorschlag</div>
                  <div className="text-xs">{p.recommendation_permanent_fix}</div>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 pt-1 border-t">
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
