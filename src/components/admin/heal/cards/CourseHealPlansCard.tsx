/**
 * AI Heal Plans + Exam-Pool Fallback Card (v3 Big Bang)
 * Zeigt Pakete mit aktivem AI-Heal-Plan + aktuellen exam_pool_fallback_state.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Brain, Zap, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface HealPlanRow {
  id: string;
  package_id: string;
  plan: { rationale?: string; confidence?: number; steps?: Array<{ action: string; target_step?: string; reason: string; expected_outcome: string }> };
  rationale: string | null;
  confidence: number | null;
  generated_at: string;
  trigger_reason: string;
  hard_fail_count_at_generation: number;
}

interface FallbackRow {
  package_id: string;
  fail_count_6h: number;
  current_stage: "normal" | "provider_switch" | "constraint_relax" | "paused";
  model_override: string | null;
  last_stage_change_at: string;
}

const STAGE_VARIANT: Record<FallbackRow["current_stage"], "default" | "secondary" | "destructive"> = {
  normal: "secondary",
  provider_switch: "default",
  constraint_relax: "default",
  paused: "destructive",
};

export function CourseHealPlansCard() {
  const qc = useQueryClient();

  const { data: plans } = useQuery({
    queryKey: ["course-heal-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_heal_plans" as never)
        .select("*")
        .eq("is_active", true)
        .order("generated_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as HealPlanRow[];
    },
    refetchInterval: 60_000,
  });

  const { data: fallback } = useQuery({
    queryKey: ["exam-pool-fallback-state"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exam_pool_fallback_state" as never)
        .select("*")
        .neq("current_stage", "normal")
        .order("last_stage_change_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as FallbackRow[];
    },
    refetchInterval: 30_000,
  });

  const { data: titles } = useQuery({
    queryKey: ["course-heal-plans-titles", (plans ?? []).map(p => p.package_id), (fallback ?? []).map(f => f.package_id)],
    enabled: ((plans?.length ?? 0) + (fallback?.length ?? 0)) > 0,
    queryFn: async () => {
      const ids = Array.from(new Set([...(plans ?? []).map(p => p.package_id), ...(fallback ?? []).map(f => f.package_id)]));
      if (ids.length === 0) return new Map<string, string>();
      const { data } = await supabase.from("course_packages").select("id,title").in("id", ids);
      return new Map((data ?? []).map((p: { id: string; title: string }) => [p.id, p.title]));
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (packageId: string) => {
      const { data, error } = await supabase.functions.invoke("course-heal-plan-generate", {
        body: { package_id: packageId, trigger_reason: "manual" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Heal-Plan generiert");
      qc.invalidateQueries({ queryKey: ["course-heal-plans"] });
    },
    onError: (e: Error) => toast.error("Plan-Generierung fehlgeschlagen", { description: e.message }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="h-4 w-4" />
          AI-Heal-Plans & Exam-Pool-Fallback
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Fallback-State */}
        <div>
          <div className="text-xs uppercase text-text-muted mb-2 flex items-center gap-1">
            <Zap className="h-3 w-3" /> Exam-Pool 3-Stufen-Fallback ({fallback?.length ?? 0} aktiv)
          </div>
          {(fallback ?? []).length === 0 ? (
            <p className="text-xs text-text-muted">Alle Pakete im Normalzustand.</p>
          ) : (
            <div className="space-y-1">
              {(fallback ?? []).slice(0, 8).map(f => (
                <div key={f.package_id} className="flex items-center justify-between text-xs py-1 border-b border-border-subtle last:border-0">
                  <span className="truncate flex-1 mr-2">{titles?.get(f.package_id) ?? f.package_id.slice(0, 8)}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={STAGE_VARIANT[f.current_stage]}>{f.current_stage}</Badge>
                    <span className="text-text-muted">{f.fail_count_6h} fails/6h</span>
                    {f.current_stage === "paused" && <AlertTriangle className="h-3 w-3 text-status-error" />}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active Plans */}
        <div>
          <div className="text-xs uppercase text-text-muted mb-2 flex items-center gap-1">
            <Brain className="h-3 w-3" /> Aktive Per-Course Heal-Plans ({plans?.length ?? 0})
          </div>
          {(plans ?? []).length === 0 ? (
            <p className="text-xs text-text-muted">Noch keine AI-Heal-Plans generiert. Werden automatisch nach Hard-Fails erstellt.</p>
          ) : (
            <div className="space-y-2">
              {(plans ?? []).slice(0, 10).map(p => (
                <div key={p.id} className="rounded-md border border-border-subtle p-2 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium truncate">{titles?.get(p.package_id) ?? p.package_id.slice(0, 8)}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{p.trigger_reason}</Badge>
                      {p.confidence !== null && <Badge variant="secondary">conf {Math.round((p.confidence ?? 0) * 100)}%</Badge>}
                      <Button size="sm" variant="ghost" disabled={generateMutation.isPending} onClick={() => generateMutation.mutate(p.package_id)}>
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  {p.rationale && <p className="text-text-muted line-clamp-2">{p.rationale}</p>}
                  <p className="text-text-muted mt-1">{p.plan?.steps?.length ?? 0} Schritte · {p.hard_fail_count_at_generation} Hard-Fails bei Generierung</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
