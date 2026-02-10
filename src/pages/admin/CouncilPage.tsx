import { useMemo, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, CheckCircle2, Pause, Play,
  ArrowUpRight, Shield, Brain, TrendingUp, Loader2, XCircle, Sparkles, Cpu,
} from "lucide-react";

type CouncilId =
  | "education" | "exam" | "marketing" | "product"
  | "tech" | "legal" | "analytics" | "operations";

const councilMeta: Record<string, { title: string; description: string }> = {
  education: { title: "Education Council", description: "Steuert Kursqualität, Didaktik und Lernpfade. Ziel: Score ≥ 92." },
  exam: { title: "Exam Council", description: "Verwaltet Prüfungsfragen, Blueprints und Exam-Simulationen." },
  marketing: { title: "Marketing & Sales Council", description: "Steuert Growth, Content-Pipeline und ROI-Optimierung." },
  product: { title: "Product Council", description: "Orchestriert Produkterstellung vom Curriculum bis Publish." },
  tech: { title: "Tech & Platform Council", description: "Überwacht Systemgesundheit, Jobs, Performance und Security." },
  legal: { title: "Legal & Compliance Council", description: "AZAV/DSGVO/Evidence Packs und Guard-Rules." },
  analytics: { title: "Analytics Council", description: "BI, KPI-Aggregation und Learner Analytics." },
  operations: { title: "Operations Council", description: "Budget, Worker Governance und Ops-Prozesse." },
};

function StatusBadge({ status }: { status: string }) {
  if (status === "ok")
    return <Badge variant="outline" className="bg-success/10 text-success border-success/30"><CheckCircle2 className="h-3 w-3 mr-1" /> OK</Badge>;
  if (status === "warning")
    return <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30"><AlertTriangle className="h-3 w-3 mr-1" /> Achtung</Badge>;
  return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30"><XCircle className="h-3 w-3 mr-1" /> Kritisch</Badge>;
}

export default function CouncilPage() {
  const { councilId } = useParams<{ councilId: string }>();
  const qc = useQueryClient();

  const meta = useMemo(() => councilMeta[councilId || ""] ?? { title: "Council", description: "" }, [councilId]);

  const [selectedCourseId, setSelectedCourseId] = useState("");

  const { data: courses } = useQuery({
    queryKey: ["admin-courses-for-council"],
    queryFn: async () => {
      const { data, error } = await supabase.from("courses").select("id,title,status").order("title");
      if (error) throw error;
      return data || [];
    },
    enabled: councilId === "education",
  });

  const { data: autopilot, refetch: refetchAutopilot } = useQuery({
    queryKey: ["council-autopilot", councilId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("council_autopilot_settings")
        .select("*")
        .eq("council_id", councilId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!councilId,
  });

  const toggleAutopilot = useCallback(async (enabled: boolean) => {
    const { error } = await supabase
      .from("council_autopilot_settings")
      .update({ enabled })
      .eq("council_id", councilId!);
    if (error) { toast.error("Fehler: " + error.message); return; }
    toast.success(enabled ? "Autopilot aktiviert" : "Autopilot deaktiviert");
    refetchAutopilot();
  }, [councilId, refetchAutopilot]);

  const { data: snapshot, isLoading } = useQuery({
    queryKey: ["council-snapshot", councilId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("council-api", {
        body: { action: "get_snapshot", councilId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    enabled: !!councilId,
    refetchInterval: 15_000,
  });

  const actionMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data, error } = await supabase.functions.invoke("council-api", { body: payload });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["council-snapshot", councilId] });
      const action = (variables as Record<string, unknown>).action as string;
      toast.success(`Aktion "${action}" erfolgreich.`);
    },
    onError: (e: Error) => toast.error(e.message || String(e)),
  });

  const isPaused = !!snapshot?.state?.isPaused;
  const killSwitch = !!snapshot?.state?.killSwitch;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <Brain className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-display font-bold text-foreground">{meta.title}</h1>
            {snapshot?.status && <StatusBadge status={snapshot.status} />}
            {isPaused && <Badge variant="outline">Pausiert</Badge>}
            {killSwitch && <Badge variant="destructive">Kill-Switch</Badge>}
          </div>
          <p className="text-muted-foreground text-sm max-w-2xl">{meta.description}</p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={actionMutation.isPending}
            onClick={() => actionMutation.mutate({ action: isPaused ? "resume" : "pause", councilId })}
          >
            {actionMutation.isPending
              ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              : isPaused ? <Play className="h-4 w-4 mr-1" /> : <Pause className="h-4 w-4 mr-1" />}
            {isPaused ? "Fortsetzen" : "Pausieren"}
          </Button>
          <Button
            variant={killSwitch ? "outline" : "destructive"}
            size="sm"
            disabled={actionMutation.isPending}
            onClick={() => actionMutation.mutate({ action: killSwitch ? "kill_off" : "kill_on", councilId })}
          >
            <Shield className="h-4 w-4 mr-1" />
            {killSwitch ? "Kill-Switch aus" : "Kill-Switch"}
          </Button>
        </div>
      </div>

      {/* Education: Auto-Improve */}
      {councilId === "education" && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Auto-Improve (Audit → Improve)
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1">
              <Select value={selectedCourseId} onValueChange={setSelectedCourseId}>
                <SelectTrigger>
                  <SelectValue placeholder="Kurs wählen …" />
                </SelectTrigger>
                <SelectContent>
                  {(courses || []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title} {c.status ? `(${c.status})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={!selectedCourseId || actionMutation.isPending || killSwitch || isPaused}
              onClick={() => actionMutation.mutate({ action: "run_auto_improve", councilId, courseId: selectedCourseId, maxLessons: 3 })}
            >
              {actionMutation.isPending
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <Sparkles className="h-4 w-4 mr-2" />}
              Auto-Improve starten
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Autopilot */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Cpu className="h-4 w-4 text-primary" /> Autopilot
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">
                Autopilot {autopilot?.enabled ? "aktiv" : "deaktiviert"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Max. {autopilot?.max_daily_actions ?? 10} Aktionen/Tag · Risiko-Schwelle: {autopilot?.risk_threshold ?? "medium"}
              </p>
              {autopilot?.allowed_actions && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {(autopilot.allowed_actions as string[]).map((a: string) => (
                    <Badge key={a} variant="secondary" className="text-xs">{a}</Badge>
                  ))}
                </div>
              )}
            </div>
            <Switch
              checked={!!autopilot?.enabled}
              onCheckedChange={toggleAutopilot}
              disabled={killSwitch}
            />
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Lade KPIs…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {(snapshot?.kpis || []).map((k: { label: string; value: number; unit?: string; progress?: number; trend?: string }) => (
            <Card key={k.label} className="glass-card">
              <CardContent className="pt-5">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{k.label}</p>
                <div className="flex items-end gap-2 mt-1">
                  <span className="text-2xl font-bold text-foreground">{k.value}{k.unit || ""}</span>
                  <span className={`text-xs flex items-center mb-1 ${k.trend === "up" ? "text-success" : "text-destructive"}`}>
                    <TrendingUp className="h-3 w-3 mr-0.5" /> {k.trend}
                  </span>
                </div>
                <Progress value={Number(k.progress ?? 0)} className="mt-2 h-1.5" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Automations */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Automationen
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(snapshot?.automations || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Automationen konfiguriert.</p>
          ) : (
            (snapshot?.automations || []).map((a: { key: string; enabled: boolean; lastRunAt?: string }) => (
              <div key={a.key} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
                <div className="flex items-center gap-3">
                  <div className={`h-2 w-2 rounded-full ${a.enabled ? "bg-success animate-pulse" : "bg-muted-foreground"}`} />
                  <span className="text-sm font-medium text-foreground">{a.key}</span>
                  {a.lastRunAt && <span className="text-xs text-muted-foreground">Letzter Lauf: {new Date(a.lastRunAt).toLocaleString("de-DE")}</span>}
                </div>
                <Badge variant="secondary" className="text-xs">{a.enabled ? "Aktiv" : "Deaktiviert"}</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Recommendations */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" /> Empfehlungen
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(snapshot?.recommendations || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine offenen Empfehlungen. 🎉</p>
          ) : (
            (snapshot?.recommendations || []).map((r: { title: string; details?: string; impact: string; risk: string }, i: number) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-warning/5 border border-warning/20">
                <div>
                  <p className="text-sm font-medium text-foreground">{r.title}</p>
                  {r.details && <p className="text-xs text-muted-foreground mt-1">{r.details}</p>}
                  <div className="flex gap-3 mt-1">
                    <span className="text-xs text-muted-foreground">Impact: <strong className="text-warning">{r.impact}</strong></span>
                    <span className="text-xs text-muted-foreground">Risiko: <strong>{r.risk}</strong></span>
                  </div>
                </div>
                <Button size="sm" variant="outline"><ArrowUpRight className="h-3 w-3 mr-1" /> Details</Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
