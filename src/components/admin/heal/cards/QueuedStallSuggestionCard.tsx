/**
 * QueuedStallSuggestionCard
 *
 * Cockpit-Flow für Pattern X5/X6: Pakete mit
 *   status='queued' + done_steps>0 + 0 active jobs
 *
 * Zeigt für jeden Kandidaten den vorgeschlagenen Heal-Schritt
 * (AUTO_PROMOTE | SKIP_TRACK_DRIFT | WAIT_GATE) plus eine
 * sichere "Heal anwenden"-Aktion.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Wand2, RefreshCw, Hourglass, SkipForward, Rocket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Candidate = {
  package_id: string;
  title: string;
  track: string | null;
  status: string;
  blocked_reason: string | null;
  updated_at: string;
  done_steps: number;
  open_steps: number;
  phantom_steps: number;
  active_jobs: number;
};

type Suggestion = {
  ok: boolean;
  package_id: string;
  title: string;
  status: string;
  blocked_reason: string | null;
  active_jobs: number;
  done_steps: number;
  open_steps: number;
  phantom_steps: number;
  unenriched_competencies: number | null;
  suggestion: "AUTO_PROMOTE" | "SKIP_TRACK_DRIFT" | "WAIT_GATE" | "WAIT" | "NONE";
  safe_to_apply: boolean;
  reason: string;
};

const SUGGESTION_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  AUTO_PROMOTE: { label: "Auto-Promote", icon: Rocket, tone: "bg-status-success-bg-subtle text-status-success-fg" },
  SKIP_TRACK_DRIFT: { label: "Phantom-Steps überspringen", icon: SkipForward, tone: "bg-status-warning-bg-subtle text-status-warning-fg" },
  WAIT_GATE: { label: "Auf Enrichment-Gate warten", icon: Hourglass, tone: "bg-status-info-bg-subtle text-status-info-fg" },
  WAIT: { label: "Warten (aktive Jobs)", icon: Hourglass, tone: "bg-surface-subtle text-text-muted" },
  NONE: { label: "Keine Aktion", icon: Hourglass, tone: "bg-surface-subtle text-text-muted" },
};

export function QueuedStallSuggestionCard() {
  const qc = useQueryClient();

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["queued-stall-candidates"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_queued_stall_candidates", { p_limit: 30 });
      if (error) throw error;
      return (data ?? []) as Candidate[];
    },
    refetchInterval: 60_000,
  });

  const suggestion = useMutation({
    mutationFn: async (pkgId: string): Promise<Suggestion> => {
      const { data, error } = await supabase.rpc("admin_suggest_heal_for_queued_stall", { p_package_id: pkgId });
      if (error) throw error;
      return data as Suggestion;
    },
  });

  const apply = useMutation({
    mutationFn: async (pkgId: string) => {
      const { data, error } = await supabase.rpc("admin_apply_suggested_heal", { p_package_id: pkgId });
      if (error) throw error;
      return data as { ok: boolean; applied?: string; error?: string };
    },
    onSuccess: (res, pkgId) => {
      if (res.ok) {
        toast.success(`Heal angewendet: ${res.applied}`);
      } else {
        toast.warning(`Nicht angewendet: ${res.error ?? "unknown"}`);
      }
      qc.invalidateQueries({ queryKey: ["queued-stall-candidates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4" />
            Queued-Stall Suggestion-Flow
          </CardTitle>
          <CardDescription>
            Pakete mit <code>status=queued</code> + Fortschritt + 0 aktiven Jobs. Cockpit schlägt sicheren Heal vor.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3 w-3 mr-1 ${isFetching ? "animate-spin" : ""}`} />
          Aktualisieren
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-text-muted">Keine Stall-Kandidaten.</p>
        ) : (
          <div className="space-y-2">
            {data.map((c) => {
              const sugg = suggestion.data && suggestion.variables === c.package_id ? suggestion.data : null;
              const meta = sugg ? SUGGESTION_META[sugg.suggestion] ?? SUGGESTION_META.NONE : null;
              const Icon = meta?.icon;
              return (
                <div key={c.package_id} className="border border-border-subtle rounded-md p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{c.title}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        <Badge variant="outline" className="text-xs">{c.track ?? "—"}</Badge>
                        <Badge variant="outline" className="text-xs">✓ {c.done_steps}</Badge>
                        <Badge variant="outline" className="text-xs">offen {c.open_steps}</Badge>
                        {c.phantom_steps > 0 && (
                          <Badge variant="outline" className="text-xs bg-status-warning-bg-subtle text-status-warning-fg">
                            phantom {c.phantom_steps}
                          </Badge>
                        )}
                      </div>
                      {c.blocked_reason && (
                        <p className="text-xs text-text-muted mt-1 truncate">Grund: {c.blocked_reason}</p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 items-end shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => suggestion.mutate(c.package_id)}
                        disabled={suggestion.isPending}
                      >
                        Vorschlag
                      </Button>
                    </div>
                  </div>

                  {sugg && meta && Icon && (
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-border-subtle">
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${meta.tone}`}>
                          <Icon className="h-3 w-3" />
                          {meta.label}
                        </span>
                        <span className="text-xs text-text-muted truncate">{sugg.reason}</span>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => apply.mutate(c.package_id)}
                        disabled={!sugg.safe_to_apply || apply.isPending}
                      >
                        Heal anwenden
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
