import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Brain, Sparkles, AlertTriangle, TrendingDown, GitBranch, Gavel, Loader2, Play, Lock, Rocket } from "lucide-react";

const APPLY_ALLOWED = new Set(["expand_question_pool", "enqueue_coverage_repair", "enqueue_integrity_check"]);
const WAVE1_PRIORITIES = new Set(["P0", "P1"]);

type ModuleKey = "failure" | "coverage" | "drift" | "council";

interface Snapshot {
  id: string;
  module: string;
  status: string;
  finding_count: number;
  recommendation_count: number;
  duration_ms: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  started_at: string;
  finished_at: string | null;
  output_summary: any;
  error_message: string | null;
}

interface Finding {
  id: string;
  module: string;
  cluster_key: string;
  severity: string;
  title: string;
  summary: string;
  root_cause: string | null;
  affected_count: number;
  status: string;
  created_at: string;
}

interface Recommendation {
  id: string;
  module: string;
  priority: string;
  action_kind: string;
  title: string;
  rationale: string;
  target_table: string | null;
  target_ids: any;
  estimated_impact: any;
  estimated_effort: string | null;
  finding_severity?: string;
  finding_cluster?: string;
  created_at: string;
  status?: string;
}

const MODULE_META: Record<ModuleKey, { label: string; icon: any; fn: string; desc: string }> = {
  failure: { label: "Failure", icon: AlertTriangle, fn: "kimi-failure-analysis", desc: "Pipeline-Fail-Cluster der letzten 7 Tage" },
  coverage: { label: "Coverage", icon: TrendingDown, fn: "kimi-coverage-analysis", desc: "done ≠ integrity_passed — Repair-Prioritäten" },
  drift: { label: "Drift", icon: GitBranch, fn: "kimi-drift-analysis", desc: "Status ≠ Realität" },
  council: { label: "Council", icon: Gavel, fn: "kimi-council-analysis", desc: "Top-Rejection-Ursachen 14 Tage" },
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-500 text-black",
  low: "bg-blue-500 text-white",
  info: "bg-gray-400 text-white",
};

const PRIORITY_COLOR: Record<string, string> = {
  P0: "bg-red-600 text-white",
  P1: "bg-orange-500 text-white",
  P2: "bg-yellow-500 text-black",
  P3: "bg-gray-400 text-white",
};

interface ConversionSummary {
  applied_repairs: number;
  jobs_completed: number;
  jobs_failed: number;
  publishable_reached: number;
  published_reached: number;
  publishable_conversion_pct: number | null;
  published_conversion_pct: number | null;
}

export default function QualityIntelligencePage() {
  const { toast } = useToast();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [conv, setConv] = useState<ConversionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<ModuleKey | null>(null);
  const [autoApplying, setAutoApplying] = useState(false);
  const [autoProgress, setAutoProgress] = useState<{ done: number; total: number; ok: number; failed: number; skipped: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, f, r, c] = await Promise.all([
      supabase.from("quality_intelligence_snapshots").select("*").order("started_at", { ascending: false }).limit(40),
      supabase.from("quality_intelligence_findings").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("quality_intelligence_recommendations").select("*").in("status", ["pending", "approved"]).order("priority").limit(200),
      supabase.from("v_qil_repair_conversion_summary" as any).select("*").maybeSingle(),
    ]);
    if (s.data) setSnapshots(s.data as any);
    if (f.data) setFindings(f.data as any);
    if (r.data) setRecs(r.data as any);
    if (c.data) setConv(c.data as any);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const runModule = async (m: ModuleKey) => {
    setRunning(m);
    try {
      const { data, error } = await supabase.functions.invoke(MODULE_META[m].fn);
      if (error) throw error;
      toast({ title: `Kimi ${MODULE_META[m].label} fertig`, description: `${data?.findings ?? 0} Findings, ${data?.recommendations ?? 0} Empfehlungen` });
      await load();
    } catch (e: any) {
      toast({ title: "Analyse fehlgeschlagen", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setRunning(null);
    }
  };

  const decide = async (id: string, status: "approved" | "rejected") => {
    const { error } = await supabase
      .from("quality_intelligence_recommendations")
      .update({ status, decided_at: new Date().toISOString(), decision_note: null })
      .eq("id", id);
    if (error) { toast({ title: "Fehler", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Empfehlung ${status === "approved" ? "angenommen" : "abgelehnt"}`, description: status === "approved" ? "Klicke 'Apply' um den Repair-Job zu enqueuen." : undefined });
    if (status === "rejected") {
      setRecs((prev) => prev.filter((r) => r.id !== id));
    } else {
      setRecs((prev) => prev.map((r) => r.id === id ? { ...r, status } : r));
    }
  };

  const apply = async (id: string) => {
    const { data, error } = await supabase.rpc("admin_apply_quality_intelligence_recommendation" as any, { p_recommendation_id: id });
    if (error) { toast({ title: "Apply fehlgeschlagen", description: error.message, variant: "destructive" }); return; }
    const d: any = data;
    if (d?.ok) {
      toast({ title: "Repair-Jobs enqueued", description: `${d.reason_code} · enqueued=${d.enqueued ?? 1} reused=${d.reused ?? 0} skipped=${d.skipped ?? 0}` });
      setRecs((prev) => prev.filter((r) => r.id !== id));
      await load();
    } else {
      toast({ title: "Apply blockiert", description: `${d?.reason_code}${d?.action_kind ? ` · ${d.action_kind}` : ""}`, variant: "destructive" });
    }
  };

  const wave1Candidates = recs.filter(
    (r) => WAVE1_PRIORITIES.has(r.priority) && APPLY_ALLOWED.has(r.action_kind) && r.status !== "rejected"
  );

  const autoApplyWave1 = async () => {
    const candidates = [...wave1Candidates];
    if (candidates.length === 0) {
      toast({ title: "Keine Wave-1-Kandidaten", description: "Es gibt aktuell keine P0/P1-Empfehlungen mit erlaubten action_kinds." });
      return;
    }
    setAutoApplying(true);
    setAutoProgress({ done: 0, total: candidates.length, ok: 0, failed: 0, skipped: 0 });
    let ok = 0, failed = 0, skipped = 0;
    for (let i = 0; i < candidates.length; i++) {
      const rec = candidates[i];
      try {
        if (rec.status !== "approved") {
          const { error: upErr } = await supabase
            .from("quality_intelligence_recommendations")
            .update({ status: "approved", decided_at: new Date().toISOString() })
            .eq("id", rec.id);
          if (upErr) throw upErr;
        }
        const { data, error } = await supabase.rpc(
          "admin_apply_quality_intelligence_recommendation" as any,
          { p_recommendation_id: rec.id }
        );
        if (error) throw error;
        const d: any = data;
        if (d?.ok) ok++;
        else skipped++;
      } catch (e) {
        failed++;
      }
      setAutoProgress({ done: i + 1, total: candidates.length, ok, failed, skipped });
    }
    setAutoApplying(false);
    toast({
      title: "Wave-1 Auto-Apply fertig",
      description: `${ok} enqueued · ${skipped} skipped · ${failed} failed (von ${candidates.length})`,
      variant: failed > 0 ? "destructive" : "default",
    });
    await load();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Brain className="h-8 w-8 text-primary" />
            Quality Intelligence Layer
          </h1>
          <p className="text-muted-foreground mt-1">
            KIMI — read-only Diagnostik über die ExamFit-Pipeline. Findet Muster, schlägt Reparaturen vor.
            Reparaturen werden ausschließlich vom Menschen freigegeben. Apply-Bridge nur für drei erlaubte Aktionen:
            <code className="text-xs ml-1">expand_question_pool</code>, <code className="text-xs">enqueue_coverage_repair</code>, <code className="text-xs">enqueue_integrity_check</code>.
          </p>
        </div>
      </div>

      <Card className="border-primary/40 bg-primary/5">
        <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <Rocket className="h-4 w-4 text-primary" /> Wave-1 Auto-Apply
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Approved und enqueued alle P0/P1-Empfehlungen mit erlaubten action_kinds in einem Durchgang.
              Aktuell: <strong>{wave1Candidates.length}</strong> Kandidaten.
            </p>
            {autoProgress && (
              <p className="text-xs mt-2">
                Fortschritt: {autoProgress.done}/{autoProgress.total} ·{" "}
                <span className="text-emerald-600">{autoProgress.ok} ok</span> ·{" "}
                <span className="text-amber-600">{autoProgress.skipped} skipped</span> ·{" "}
                <span className="text-red-600">{autoProgress.failed} failed</span>
              </p>
            )}
          </div>
          <Button
            onClick={autoApplyWave1}
            disabled={autoApplying || wave1Candidates.length === 0}
            size="lg"
          >
            {autoApplying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Rocket className="h-4 w-4 mr-2" />}
            {autoApplying ? `Läuft… ${autoProgress?.done ?? 0}/${autoProgress?.total ?? 0}` : `Auto-Apply (${wave1Candidates.length})`}
          </Button>
        </CardContent>
      </Card>

      {conv && (
        <Card className="border-emerald-500/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Play className="h-4 w-4 text-emerald-600" /> Repair Conversion (KIMI.INTELLIGENCE.1a)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
              <div><div className="text-muted-foreground text-xs">Applied</div><div className="text-2xl font-semibold">{conv.applied_repairs}</div></div>
              <div><div className="text-muted-foreground text-xs">Jobs ok</div><div className="text-2xl font-semibold text-emerald-600">{conv.jobs_completed}</div></div>
              <div><div className="text-muted-foreground text-xs">Jobs failed</div><div className="text-2xl font-semibold text-red-600">{conv.jobs_failed}</div></div>
              <div><div className="text-muted-foreground text-xs">Publishable</div><div className="text-2xl font-semibold">{conv.publishable_reached}</div></div>
              <div><div className="text-muted-foreground text-xs">Published</div><div className="text-2xl font-semibold">{conv.published_reached}</div></div>
              <div>
                <div className="text-muted-foreground text-xs">Conversion</div>
                <div className="text-2xl font-semibold">
                  {conv.publishable_conversion_pct ?? 0}% / {conv.published_conversion_pct ?? 0}%
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Beweiskette: applied → job ok → publishable → published. Erst eine echte Conversion macht KIMI zum Produktionshebel.
            </p>
          </CardContent>
        </Card>
      )}


      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {(Object.keys(MODULE_META) as ModuleKey[]).map((m) => {
          const meta = MODULE_META[m];
          const Icon = meta.icon;
          const last = snapshots.find((s) => s.module === m);
          return (
            <Card key={m}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="h-4 w-4" /> {meta.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">{meta.desc}</p>
                <div className="text-xs">
                  {last ? (
                    <>
                      <div>Findings: <strong>{last.finding_count}</strong> · Recs: <strong>{last.recommendation_count}</strong></div>
                      <div className="text-muted-foreground">{new Date(last.started_at).toLocaleString()}</div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">noch nie ausgeführt</span>
                  )}
                </div>
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => runModule(m)}
                  disabled={running !== null}
                >
                  {running === m ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
                  Jetzt analysieren
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs defaultValue="recommendations">
        <TabsList>
          <TabsTrigger value="recommendations">Empfehlungen ({recs.length})</TabsTrigger>
          <TabsTrigger value="findings">Findings ({findings.length})</TabsTrigger>
          <TabsTrigger value="snapshots">Läufe ({snapshots.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="recommendations" className="space-y-3">
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
          {!loading && recs.length === 0 && (
            <Card><CardContent className="py-8 text-center text-muted-foreground">
              Keine offenen Empfehlungen. Führe oben ein Modul aus.
            </CardContent></Card>
          )}
          {recs.map((r) => {
            const isApproved = r.status === "approved";
            const applicable = APPLY_ALLOWED.has(r.action_kind);
            return (
              <Card key={r.id} className={isApproved ? "border-emerald-500/50" : undefined}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={PRIORITY_COLOR[r.priority]}>{r.priority}</Badge>
                        <Badge variant="outline">{r.module}</Badge>
                        <Badge variant={applicable ? "default" : "secondary"} className={applicable ? "" : "opacity-70"}>
                          {!applicable && <Lock className="h-3 w-3 mr-1 inline" />}{r.action_kind}
                        </Badge>
                        {r.estimated_effort && <Badge variant="secondary">Effort: {r.estimated_effort}</Badge>}
                        {isApproved && <Badge className="bg-emerald-600 text-white">approved</Badge>}
                      </div>
                      <h3 className="font-semibold mt-2">{r.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{r.rationale}</p>
                      {r.estimated_impact && Object.keys(r.estimated_impact).length > 0 && (
                        <div className="text-xs mt-2 text-emerald-700 dark:text-emerald-400">
                          Impact: {JSON.stringify(r.estimated_impact)}
                        </div>
                      )}
                      {Array.isArray(r.target_ids) && r.target_ids.length > 0 && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {r.target_ids.length} betroffene {r.target_table ?? "Objekte"}
                        </div>
                      )}
                      {!applicable && (
                        <div className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                          Diese Aktion ist außerhalb der KIMI.INTELLIGENCE.1a Allowlist und muss manuell umgesetzt werden.
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      {!isApproved && <Button size="sm" onClick={() => decide(r.id, "approved")}>Annehmen</Button>}
                      {isApproved && applicable && (
                        <Button size="sm" onClick={() => apply(r.id)} className="bg-emerald-600 hover:bg-emerald-700">
                          <Play className="h-3 w-3 mr-1" /> Apply
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => decide(r.id, "rejected")}>Ablehnen</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="findings" className="space-y-3">
          {findings.map((f) => (
            <Card key={f.id}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={SEVERITY_COLOR[f.severity]}>{f.severity}</Badge>
                  <Badge variant="outline">{f.module}</Badge>
                  <Badge variant="secondary">{f.cluster_key}</Badge>
                  <Badge variant="outline">{f.status}</Badge>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {new Date(f.created_at).toLocaleString()}
                  </span>
                </div>
                <h3 className="font-semibold mt-2">{f.title}</h3>
                <p className="text-sm mt-1">{f.summary}</p>
                {f.root_cause && (
                  <p className="text-xs text-muted-foreground mt-2">
                    <strong>Root Cause:</strong> {f.root_cause}
                  </p>
                )}
                <div className="text-xs text-muted-foreground mt-1">
                  {f.affected_count} betroffene Objekte
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="snapshots" className="space-y-2">
          {snapshots.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-3 flex items-center justify-between text-sm">
                <div>
                  <Badge variant="outline">{s.module}</Badge>{" "}
                  <Badge className={s.status === "succeeded" ? "bg-emerald-600 text-white" : s.status === "failed" ? "bg-red-600 text-white" : ""}>
                    {s.status}
                  </Badge>{" "}
                  <span>{s.finding_count} F / {s.recommendation_count} R</span>
                  {s.error_message && <span className="text-red-600 ml-2">{s.error_message}</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {s.duration_ms ?? 0}ms · {(s.tokens_input ?? 0) + (s.tokens_output ?? 0)} tok ·{" "}
                  {new Date(s.started_at).toLocaleString()}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
