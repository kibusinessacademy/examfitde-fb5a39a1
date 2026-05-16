import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Route, RefreshCw } from "lucide-react";

type Health = {
  paths?: { active?: number; completed?: number; superseded?: number; abandoned?: number };
  effectiveness?: Array<{
    step_type: string;
    served: number;
    completed: number;
    skipped: number;
    blocked: number;
    completion_rate_pct: number | null;
  }>;
  constraints?: { active?: number; hard_blocks?: number };
  recent_decisions?: Array<{ step_type: string; decision: string; decided_at: string }>;
  generated_at?: string;
};

export function AdaptivePathOrchestrationCard() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("admin_get_adaptive_path_health" as any);
      if (error) throw error;
      setHealth((data as Health) || null);
    } catch (e: any) {
      toast.error(e?.message ?? "Adaptive Path Health laden fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const p = health?.paths ?? {};
  const c = health?.constraints ?? {};

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Route className="h-4 w-4" /> Adaptive Path Orchestration (Bridge 13)
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <KPI label="Active Paths" value={p.active ?? 0} />
          <KPI label="Completed" value={p.completed ?? 0} />
          <KPI label="Superseded" value={p.superseded ?? 0} />
          <KPI label="Constraints (Hard)" value={`${c.active ?? 0} / ${c.hard_blocks ?? 0}`} />
        </div>

        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2">
            Effectiveness (30d)
          </div>
          {(health?.effectiveness ?? []).length === 0 ? (
            <div className="text-xs text-muted-foreground">Noch keine Decisions erfasst.</div>
          ) : (
            <div className="space-y-1">
              {health!.effectiveness!.map((e) => (
                <div
                  key={e.step_type}
                  className="flex items-center justify-between text-xs border rounded px-2 py-1"
                >
                  <span className="font-mono">{e.step_type}</span>
                  <div className="flex gap-1 flex-wrap">
                    <Badge variant="outline">served {e.served}</Badge>
                    <Badge variant="outline">done {e.completed}</Badge>
                    <Badge variant="outline">skip {e.skipped}</Badge>
                    {e.blocked > 0 && <Badge variant="destructive">block {e.blocked}</Badge>}
                    {e.completion_rate_pct != null && (
                      <Badge>{e.completion_rate_pct}%</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2">
            Recent Decisions
          </div>
          {(health?.recent_decisions ?? []).length === 0 ? (
            <div className="text-xs text-muted-foreground">—</div>
          ) : (
            <div className="space-y-1 max-h-40 overflow-auto">
              {health!.recent_decisions!.slice(0, 10).map((d, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span className="font-mono">{d.step_type}</span>
                  <Badge variant="outline">{d.decision}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="text-[10px] text-muted-foreground">
          SSOT-bounded: nur veröffentlichte Lessons, freigegebene Blueprints, validierte
          Dependency-Edges. Kein Content-Rewrite, keine Curriculum-Mutation.
        </p>
      </CardContent>
    </Card>
  );
}

function KPI({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="border rounded p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
