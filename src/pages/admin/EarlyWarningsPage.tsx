import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  AlertTriangle, RefreshCw, Loader2, Shield, Activity, DollarSign, GraduationCap, Cpu
} from "lucide-react";

const riskIcons: Record<string, React.ElementType> = {
  system_risk: Cpu,
  quality_risk: GraduationCap,
  budget_risk: DollarSign,
};

const severityColors: Record<string, string> = {
  low: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning border-warning/30",
  critical: "bg-destructive/10 text-destructive border-destructive/30",
};

export default function EarlyWarningsPage() {
  const qc = useQueryClient();

  const { data: scores, isLoading } = useQuery({
    queryKey: ["risk-scores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("risk_scores")
        .select("*")
        .order("score", { ascending: false });
      if (error) throw error;
      return (data || []) as Array<Record<string, unknown>>;
    },
    refetchInterval: 30_000,
  });

  const runEngine = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("early-warning-engine", { body: {} });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Engine ausgeführt: ${data?.scores?.length || 0} Scores berechnet, ${data?.escalated || 0} Eskalationen`);
      qc.invalidateQueries({ queryKey: ["risk-scores"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-warning" /> Early Warning System
          </h1>
          <p className="text-sm text-muted-foreground">Predictive Risk Scores: Qualität, System, Budget</p>
        </div>
        <Button onClick={() => runEngine.mutate()} disabled={runEngine.isPending}>
          {runEngine.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          Engine ausführen
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (scores || []).length === 0 ? (
        <Card className="glass-card">
          <CardContent className="py-8 text-center text-muted-foreground">
            Keine Risk Scores vorhanden. Klicke "Engine ausführen" um Scores zu berechnen.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(scores || []).map((s: Record<string, unknown>) => {
            const RiskIcon = riskIcons[s.risk_type as string] || Activity;
            const sevClass = severityColors[s.severity as string] || severityColors.low;
            const evidence = (s.evidence || {}) as Record<string, unknown>;
            return (
              <Card key={`${s.scope_id}-${s.risk_type}`} className="glass-card">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <RiskIcon className="h-4 w-4 text-primary" />
                      {(s.risk_type as string || "").replace("_", " ").toUpperCase()}
                    </CardTitle>
                    <Badge className={sevClass}>{s.severity as string}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Council: <strong>{s.scope_id as string}</strong></span>
                      <span className="font-bold text-foreground">{s.score as number}/100</span>
                    </div>
                    <Progress value={s.score as number} className="h-2" />
                  </div>
                  <div className="space-y-1">
                    {Object.entries(evidence).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{k}</span>
                        <span className="text-foreground font-medium">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                  {s.computed_at && (
                    <p className="text-[10px] text-muted-foreground">
                      Berechnet: {new Date(s.computed_at as string).toLocaleString("de-DE")}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
