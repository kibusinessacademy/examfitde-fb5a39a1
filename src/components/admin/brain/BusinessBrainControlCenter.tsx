import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Brain, BarChart3, Target, Zap, ShieldAlert, Users, Package,
  CheckCircle, XCircle, Clock, TrendingUp, TrendingDown,
  AlertTriangle, Loader2, RefreshCw, Play, ThumbsUp, ThumbsDown,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────
interface SnapshotResponse {
  success: boolean;
  snapshot_id: string;
  summary: {
    overall_health: string;
    top_risk: string;
    top_opportunity: string;
    risk_score: number;
    opportunity_score: number;
  };
  metrics: Record<string, Record<string, number>>;
}

interface Recommendation {
  id: string;
  recommendation_type: string;
  priority_score: number;
  confidence_score: number;
  title: string;
  summary: string;
  rationale: Record<string, unknown>;
  recommended_action: Record<string, unknown>;
  ai_summary: string | null;
  ai_rationale: string | null;
  ai_risk_notes: string | null;
  ai_expected_impact: string | null;
  status: string;
  execution_mode: string;
  created_at: string;
}

interface Goal {
  id: string;
  goal_type: string;
  target_value: number;
  current_value: number | null;
  weight: number;
  time_horizon: string;
  strategy_mode: string;
  status: string;
}

interface ActionQueueItem {
  id: string;
  action_type: string;
  action_payload: Record<string, unknown>;
  status: string;
  execution_mode: string;
  executed_at: string | null;
  error_message: string | null;
  created_at: string;
}

// ─── Hooks ─────────────────────────────────────────────────────
function useLatestSnapshot() {
  return useQuery({
    queryKey: ["admin", "bb-snapshot"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_brain_snapshots")
        .select("*")
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    refetchInterval: 30_000,
  });
}

function useRecommendations(status: string) {
  return useQuery({
    queryKey: ["admin", "bb-recs", status],
    queryFn: async () => {
      let query = supabase
        .from("business_brain_recommendations")
        .select("*")
        .order("priority_score", { ascending: false })
        .limit(50);
      if (status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as Recommendation[];
    },
    refetchInterval: 15_000,
  });
}

function useGoals() {
  return useQuery({
    queryKey: ["admin", "bb-goals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_brain_goals")
        .select("*")
        .order("weight", { ascending: false });
      if (error) throw error;
      return (data || []) as Goal[];
    },
  });
}

function useActionQueue() {
  return useQuery({
    queryKey: ["admin", "bb-actions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_brain_action_queue")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as ActionQueueItem[];
    },
    refetchInterval: 15_000,
  });
}

// ─── Sub-Components ────────────────────────────────────────────

function HealthBadge({ value }: { value: string }) {
  const map: Record<string, { variant: "default" | "destructive" | "secondary" | "outline"; icon: typeof CheckCircle }> = {
    healthy: { variant: "default", icon: CheckCircle },
    warning: { variant: "secondary", icon: AlertTriangle },
    critical: { variant: "destructive", icon: ShieldAlert },
  };
  const cfg = map[value] || map.healthy;
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.variant} className="gap-1">
      <Icon className="h-3 w-3" /> {value}
    </Badge>
  );
}

function MetricCard({ label, value, icon: Icon, trend }: { label: string; value: number | string; icon: typeof BarChart3; trend?: "up" | "down" | "flat" }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{label}</span>
          </div>
          {trend === "up" && <TrendingUp className="h-3 w-3 text-green-500" />}
          {trend === "down" && <TrendingDown className="h-3 w-3 text-red-500" />}
        </div>
        <p className="text-lg font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}

function RecTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    operational_fix: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    seo_priority: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    content_job: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
    revenue_action: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    product_priority: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    growth_action: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
    retention_action: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${colors[type] || "bg-muted text-muted-foreground"}`}>{type.replace(/_/g, " ")}</span>;
}

// ─── Executive Overview Tab ────────────────────────────────────
function ExecutiveOverview() {
  const { data: snap, isLoading } = useLatestSnapshot();
  const qc = useQueryClient();

  const runSnapshot = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("business-brain-snapshot", {
        body: { snapshot_type: "on_demand" },
      });
      if (error) throw error;
      return data as SnapshotResponse;
    },
    onSuccess: () => {
      toast.success("Snapshot erstellt");
      qc.invalidateQueries({ queryKey: ["admin", "bb-snapshot"] });
      qc.invalidateQueries({ queryKey: ["admin", "bb-recs"] });
    },
    onError: (e) => toast.error("Snapshot fehlgeschlagen: " + e.message),
  });

  const runOrchestrator = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("business-brain-orchestrator");
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Orchestrator abgeschlossen – ${data?.steps?.length || 0} Steps`);
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e) => toast.error("Orchestrator fehlgeschlagen: " + e.message),
  });

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const m = snap || {} as Record<string, Record<string, number>>;
  const learning = (m.learning_metrics || {}) as Record<string, number>;
  const risk = (m.risk_metrics || {}) as Record<string, number>;
  const opp = (m.opportunity_metrics || {}) as Record<string, number>;
  const product = (m.product_metrics || {}) as Record<string, number>;
  const summary = (m.summary || {}) as Record<string, string | number>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">System Health</h2>
          <HealthBadge value={String(summary.overall_health || "unknown")} />
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => runSnapshot.mutate()} disabled={runSnapshot.isPending}>
            <RefreshCw className={`h-3 w-3 mr-1 ${runSnapshot.isPending ? "animate-spin" : ""}`} /> Snapshot
          </Button>
          <Button size="sm" onClick={() => runOrchestrator.mutate()} disabled={runOrchestrator.isPending}>
            <Play className={`h-3 w-3 mr-1 ${runOrchestrator.isPending ? "animate-spin" : ""}`} /> Full Cycle
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MetricCard label="Aktive Lernende" value={learning.active_learners || 0} icon={Users} />
        <MetricCard label="Published Packages" value={product.published || 0} icon={Package} />
        <MetricCard label="Failed Jobs (24h)" value={risk.failed_jobs_24h || 0} icon={ShieldAlert} trend={Number(risk.failed_jobs_24h) > 5 ? "down" : "flat"} />
        <MetricCard label="Content Gaps" value={opp.keywords_without_content || 0} icon={Target} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MetricCard label="Stalled Packages" value={risk.stalled_packages || 0} icon={Clock} />
        <MetricCard label="Blocked" value={risk.blocked_packages || 0} icon={AlertTriangle} />
        <MetricCard label="Publishable" value={opp.publishable_packages || 0} icon={CheckCircle} />
        <MetricCard label="AI Budget %" value={`${risk.ai_budget_pct || 0}%`} icon={BarChart3} />
      </div>

      {snap?.generated_at && (
        <p className="text-[10px] text-muted-foreground">Letzter Snapshot: {new Date(snap.generated_at).toLocaleString("de-DE")}</p>
      )}
    </div>
  );
}

// ─── Recommendations Tab ───────────────────────────────────────
function RecommendationsTab() {
  const [statusFilter, setStatusFilter] = useState("proposed");
  const { data: recs = [], isLoading } = useRecommendations(statusFilter);
  const qc = useQueryClient();

  const decideMutation = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: string }) => {
      const { error } = await supabase.functions.invoke("business-brain-recommendations", {
        body: { action: "decide", recommendation_id: id, decision },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Entscheidung gespeichert");
      qc.invalidateQueries({ queryKey: ["admin", "bb-recs"] });
      qc.invalidateQueries({ queryKey: ["admin", "bb-actions"] });
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle</SelectItem>
            <SelectItem value="proposed">Vorgeschlagen</SelectItem>
            <SelectItem value="approved">Genehmigt</SelectItem>
            <SelectItem value="rejected">Abgelehnt</SelectItem>
            <SelectItem value="executed">Ausgeführt</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="outline" className="text-xs">{recs.length} Empfehlungen</Badge>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : recs.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Keine Empfehlungen in diesem Status.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {recs.map((rec) => (
            <Card key={rec.id}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <RecTypeBadge type={rec.recommendation_type} />
                      <Badge variant="outline" className="text-[10px]">P: {Math.round(rec.priority_score)}</Badge>
                      <Badge variant="outline" className="text-[10px]">C: {Math.round(rec.confidence_score)}%</Badge>
                      {rec.execution_mode === "auto_allowed" && <Badge className="text-[10px] bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">Auto</Badge>}
                    </div>
                    <p className="text-sm font-medium mt-1">{rec.title}</p>
                    <p className="text-xs text-muted-foreground">{rec.summary}</p>
                  </div>
                  {rec.status === "proposed" && (
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => decideMutation.mutate({ id: rec.id, decision: "approve" })}>
                        <ThumbsUp className="h-3 w-3 text-green-600" />
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => decideMutation.mutate({ id: rec.id, decision: "reject" })}>
                        <ThumbsDown className="h-3 w-3 text-red-600" />
                      </Button>
                    </div>
                  )}
                </div>
                {rec.ai_summary && (
                  <div className="bg-muted/50 rounded p-2 text-xs space-y-1">
                    <p><strong>AI:</strong> {rec.ai_summary}</p>
                    {rec.ai_risk_notes && <p className="text-muted-foreground">⚠️ {rec.ai_risk_notes}</p>}
                    {rec.ai_expected_impact && <p className="text-muted-foreground">📈 {rec.ai_expected_impact}</p>}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Goals Tab ─────────────────────────────────────────────────
function GoalsTab() {
  const { data: goals = [], isLoading } = useGoals();
  const qc = useQueryClient();
  const [newGoalType, setNewGoalType] = useState("revenue_growth");
  const [newTarget, setNewTarget] = useState("100");
  const [strategyMode, setStrategyMode] = useState("balanced");

  const createGoal = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("business_brain_goals").insert({
        goal_type: newGoalType,
        target_value: Number(newTarget),
        weight: 1,
        strategy_mode: strategyMode,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ziel erstellt");
      qc.invalidateQueries({ queryKey: ["admin", "bb-goals"] });
    },
  });

  const updateWeight = useMutation({
    mutationFn: async ({ id, weight }: { id: string; weight: number }) => {
      const { error } = await supabase.from("business_brain_goals").update({ weight, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "bb-goals"] }),
  });

  const strategyModes = [
    { value: "balanced", label: "⚖️ Balanced", desc: "Alle Ziele moderat gewichten" },
    { value: "growth_first", label: "🚀 Growth First", desc: "SEO, Content, Sharing priorisieren" },
    { value: "revenue_first", label: "💰 Revenue First", desc: "Offers, Bundles, Conversion priorisieren" },
    { value: "quality_first", label: "🎓 Quality First", desc: "Lernqualität und Prüfungsnähe priorisieren" },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Strategy Mode</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {strategyModes.map((m) => (
              <button
                key={m.value}
                onClick={() => setStrategyMode(m.value)}
                className={`p-2 rounded-lg border text-left text-xs transition-all ${
                  strategyMode === m.value ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/50"
                }`}
              >
                <p className="font-medium">{m.label}</p>
                <p className="text-muted-foreground text-[10px] mt-0.5">{m.desc}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Neues Ziel</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 items-end">
            <Select value={newGoalType} onValueChange={setNewGoalType}>
              <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["revenue_growth", "traffic_growth", "seo_visibility", "course_completion", "exam_success_rate", "retention", "content_output"].map((t) => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input className="w-24 h-8 text-xs" type="number" value={newTarget} onChange={(e) => setNewTarget(e.target.value)} placeholder="Zielwert" />
            <Button size="sm" className="h-8" onClick={() => createGoal.mutate()} disabled={createGoal.isPending}>Erstellen</Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          {goals.map((g) => (
            <Card key={g.id}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-xs font-medium">{g.goal_type.replace(/_/g, " ")}</p>
                    <p className="text-[10px] text-muted-foreground">{g.time_horizon} · {g.strategy_mode}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">{g.current_value ?? "–"} / {g.target_value}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-12">Gewicht</span>
                  <Slider
                    value={[g.weight]}
                    onValueChange={([v]) => updateWeight.mutate({ id: g.id, weight: v })}
                    min={0.1} max={3} step={0.1}
                    className="flex-1"
                  />
                  <span className="text-xs font-mono w-8">{g.weight.toFixed(1)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Action Queue Tab ──────────────────────────────────────────
function ActionQueueTab() {
  const { data: actions = [], isLoading } = useActionQueue();
  const qc = useQueryClient();

  const approveAction = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("business_brain_action_queue").update({
        status: "approved",
        updated_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Aktion genehmigt");
      qc.invalidateQueries({ queryKey: ["admin", "bb-actions"] });
    },
  });

  const rejectAction = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("business_brain_action_queue").update({
        status: "rejected",
        updated_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Aktion abgelehnt");
      qc.invalidateQueries({ queryKey: ["admin", "bb-actions"] });
    },
  });

  const statusIcon: Record<string, typeof CheckCircle> = {
    queued: Clock,
    approved: CheckCircle,
    executing: Loader2,
    executed: CheckCircle,
    failed: XCircle,
    rejected: XCircle,
  };

  return (
    <div className="space-y-2">
      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : actions.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Keine Aktionen in der Queue.</CardContent></Card>
      ) : (
        actions.map((a) => {
          const Icon = statusIcon[a.status] || Clock;
          return (
            <Card key={a.id}>
              <CardContent className="p-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Icon className={`h-4 w-4 shrink-0 ${a.status === "failed" ? "text-destructive" : a.status === "executed" ? "text-green-600" : "text-muted-foreground"}`} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{a.action_type.replace(/_/g, " ")}</p>
                    <p className="text-[10px] text-muted-foreground">{a.execution_mode} · {new Date(a.created_at).toLocaleDateString("de-DE")}</p>
                    {a.error_message && <p className="text-[10px] text-destructive mt-0.5">{a.error_message}</p>}
                  </div>
                </div>
                {(a.status === "queued" || a.status === "approved") && a.execution_mode === "manual_review" && (
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => approveAction.mutate(a.id)}>
                      <ThumbsUp className="h-3 w-3 text-green-600" />
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => rejectAction.mutate(a.id)}>
                      <ThumbsDown className="h-3 w-3 text-red-600" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

// ─── Risk Tab ──────────────────────────────────────────────────
function RiskTab() {
  const { data: snap } = useLatestSnapshot();
  const risk = (snap?.risk_metrics || {}) as Record<string, number>;

  const items = [
    { label: "Stalled Packages (>6h)", value: risk.stalled_packages || 0, threshold: 3 },
    { label: "Failed Jobs (24h)", value: risk.failed_jobs_24h || 0, threshold: 5 },
    { label: "Blocked Packages", value: risk.blocked_packages || 0, threshold: 5 },
    { label: "Quality Gate Failed", value: risk.qgf_packages || 0, threshold: 3 },
    { label: "Pending Jobs", value: risk.pending_jobs || 0, threshold: 50 },
    { label: "AI Budget %", value: risk.ai_budget_pct || 0, threshold: 80 },
    { label: "Failed Content Jobs", value: risk.content_jobs_failed || 0, threshold: 5 },
  ];

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {Number(item.value) >= item.threshold ? (
                <ShieldAlert className="h-4 w-4 text-destructive" />
              ) : (
                <CheckCircle className="h-4 w-4 text-green-600" />
              )}
              <span className="text-xs">{item.label}</span>
            </div>
            <span className={`text-sm font-bold ${Number(item.value) >= item.threshold ? "text-destructive" : ""}`}>{item.value}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Product Portfolio Tab ─────────────────────────────────────
function ProductPortfolioTab() {
  const { data: snap } = useLatestSnapshot();
  const product = (snap?.product_metrics || {}) as Record<string, number>;
  const opp = (snap?.opportunity_metrics || {}) as Record<string, number>;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <MetricCard label="Total Packages" value={product.total_packages || 0} icon={Package} />
        <MetricCard label="Published" value={product.published || 0} icon={CheckCircle} />
        <MetricCard label="Building" value={product.building || 0} icon={Loader2} />
        <MetricCard label="Curricula" value={product.total_curricula || 0} icon={Target} />
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Opportunities</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-xs"><span>Curricula ohne Paket</span><strong>{opp.curricula_without_package || 0}</strong></div>
          <div className="flex justify-between text-xs"><span>Publishable Packages (≥95%)</span><strong>{opp.publishable_packages || 0}</strong></div>
          <div className="flex justify-between text-xs"><span>High-Risk / Low-Readiness Users</span><strong>{opp.high_risk_low_readiness || 0}</strong></div>
          <div className="flex justify-between text-xs"><span>Keywords ohne Content</span><strong>{opp.keywords_without_content || 0}</strong></div>
          <div className="flex justify-between text-xs"><span>Engagierte User ohne Offer</span><strong>{opp.high_engagement_no_offer || 0}</strong></div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Segment Intelligence Tab ──────────────────────────────────
function SegmentTab() {
  const { data: snap } = useLatestSnapshot();
  const learning = (snap?.learning_metrics || {}) as Record<string, number | Record<string, number>>;
  const revenue = (snap?.revenue_metrics || {}) as Record<string, number>;
  const growth = (snap?.growth_metrics || {}) as Record<string, number>;
  const readinessDist = (learning.readiness_distribution || {}) as Record<string, number>;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Readiness-Segmente</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-xs"><span className="text-red-600">Low (&lt;40%)</span><strong>{readinessDist.low || 0}</strong></div>
          <div className="flex justify-between text-xs"><span className="text-amber-600">Medium (40–70%)</span><strong>{readinessDist.medium || 0}</strong></div>
          <div className="flex justify-between text-xs"><span className="text-green-600">High (&gt;70%)</span><strong>{readinessDist.high || 0}</strong></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Revenue Segments</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-xs"><span>High-Risk Users</span><strong>{revenue.high_risk_users || 0}</strong></div>
          <div className="flex justify-between text-xs"><span>Avg Purchase Probability</span><strong>{revenue.avg_purchase_probability || 0}%</strong></div>
          <div className="flex justify-between text-xs"><span>Avg LTV</span><strong>€{revenue.avg_ltv || 0}</strong></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Growth Segments</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-xs"><span>Shares (30d)</span><strong>{growth.shares_30d || 0}</strong></div>
          <div className="flex justify-between text-xs"><span>Referrals (rewarded)</span><strong>{growth.referrals_rewarded || 0}</strong></div>
          <div className="flex justify-between text-xs"><span>Avg Virality Score</span><strong>{growth.avg_virality_score || 0}</strong></div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────
export default function BusinessBrainControlCenter() {
  return (
    <div className="space-y-4">
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1 rounded-xl">
          <TabsTrigger value="overview" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <BarChart3 className="h-3 w-3" /> Overview
          </TabsTrigger>
          <TabsTrigger value="recommendations" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <Zap className="h-3 w-3" /> Empfehlungen
          </TabsTrigger>
          <TabsTrigger value="goals" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <Target className="h-3 w-3" /> Goals
          </TabsTrigger>
          <TabsTrigger value="actions" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <Play className="h-3 w-3" /> Actions
          </TabsTrigger>
          <TabsTrigger value="portfolio" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <Package className="h-3 w-3" /> Portfolio
          </TabsTrigger>
          <TabsTrigger value="risk" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <ShieldAlert className="h-3 w-3" /> Risk
          </TabsTrigger>
          <TabsTrigger value="segments" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <Users className="h-3 w-3" /> Segmente
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4"><ExecutiveOverview /></TabsContent>
        <TabsContent value="recommendations" className="mt-4"><RecommendationsTab /></TabsContent>
        <TabsContent value="goals" className="mt-4"><GoalsTab /></TabsContent>
        <TabsContent value="actions" className="mt-4"><ActionQueueTab /></TabsContent>
        <TabsContent value="portfolio" className="mt-4"><ProductPortfolioTab /></TabsContent>
        <TabsContent value="risk" className="mt-4"><RiskTab /></TabsContent>
        <TabsContent value="segments" className="mt-4"><SegmentTab /></TabsContent>
      </Tabs>
    </div>
  );
}
