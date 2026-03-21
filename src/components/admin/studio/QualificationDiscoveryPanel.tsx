import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Play, RefreshCw, BookOpen, GraduationCap, Award, Zap } from "lucide-react";

export default function QualificationDiscoveryPanel() {
  const [state, setState] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [cronRunning, setCronRunning] = useState(false);
  const [promoteRunning, setPromoteRunning] = useState(false);

  async function load() {
    setLoading(true);
    const [statusRes, waveRes, catalogRes, draftsRes, promotedRes] = await Promise.all([
      supabase.functions.invoke("qualification-intake-admin", { body: { action: "status" } }),
      supabase.functions.invoke("qualification-intake-admin", { body: { action: "wave_candidates" } }),
      supabase.functions.invoke("qualification-intake-admin", { body: { action: "catalog" } }),
      supabase.functions.invoke("qualification-intake-admin", { body: { action: "ready_drafts" } }),
      supabase.functions.invoke("qualification-intake-admin", { body: { action: "promoted" } }),
    ]);
    setState({
      status: statusRes.data,
      waveCandidates: waveRes.data?.candidates || [],
      catalog: catalogRes.data?.catalog || [],
      drafts: draftsRes.data?.drafts || [],
      promoted: promotedRes.data?.promoted || [],
    });
    setLoading(false);
  }

  async function runCron() {
    setCronRunning(true);
    await supabase.functions.invoke("qualification-intake-admin", { body: { action: "run_cron" } });
    await load();
    setCronRunning(false);
  }

  async function runPromote() {
    setPromoteRunning(true);
    await supabase.functions.invoke("qualification-intake-admin", { body: { action: "promote_blueprint" } });
    await load();
    setPromoteRunning(false);
  }

  useEffect(() => { load(); }, []);

  const s = state.status || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Qualification Intake Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Dual + Fortbildung · Discovery → Parse → Catalog → Draft → Curriculum → Blueprint → Questions
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={runPromote} disabled={promoteRunning}>
            {promoteRunning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Zap className="h-4 w-4 mr-1" />}
            Promote & Blueprint
          </Button>
          <Button size="sm" onClick={runCron} disabled={cronRunning}>
            {cronRunning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
            Full Intake Run
          </Button>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1"><BookOpen className="h-3.5 w-3.5" /> Search Runs</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{s.search_runs ?? "–"}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Candidates</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{s.candidates ?? "–"}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1"><GraduationCap className="h-3.5 w-3.5" /> Catalog</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{s.catalog_entries ?? "–"}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1"><Award className="h-3.5 w-3.5" /> Fortbildung</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{s.fortbildung_catalog ?? "–"}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Drafts Ready</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{s.drafts_ready ?? "–"}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1"><Zap className="h-3.5 w-3.5" /> Promoted</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{s.promoted_curricula ?? "–"}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Blueprinted</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{s.blueprinted ?? "–"}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Seed Runs</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{s.seed_runs_done ?? "–"}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Pending Fetches</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{s.pending_fetches ?? "–"}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Wave Candidates</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{s.wave_candidates ?? "–"}</div></CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="promoted">
        <TabsList>
          <TabsTrigger value="promoted">Promoted Curricula</TabsTrigger>
          <TabsTrigger value="catalog">Qualification Catalog</TabsTrigger>
          <TabsTrigger value="drafts">Ready Drafts</TabsTrigger>
          <TabsTrigger value="wave">Wave Candidates</TabsTrigger>
        </TabsList>

        <TabsContent value="promoted" className="space-y-2 mt-3">
          {(state.promoted || []).length === 0 && (
            <p className="text-sm text-muted-foreground">Keine promoted Curricula vorhanden.</p>
          )}
          {(state.promoted || []).map((p: any) => (
            <div key={p.id} className="rounded-lg border p-3">
              <div className="font-medium text-sm">{p.draft?.draft_title || p.curriculum?.title}</div>
              <div className="flex gap-2 mt-1 flex-wrap">
                <Badge variant={p.promotion_status === "question_seeded" ? "default" : "outline"}>
                  {p.promotion_status}
                </Badge>
                {p.draft?.award_type && <Badge variant="secondary">{p.draft.award_type}</Badge>}
                {p.draft?.education_type && <Badge variant="outline">{p.draft.education_type}</Badge>}
                <span className="text-xs text-muted-foreground">
                  Readiness {p.draft?.readiness_score} · Curriculum: {p.curriculum?.status}
                </span>
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="catalog" className="space-y-2 mt-3">
          {(state.catalog || []).length === 0 && (
            <p className="text-sm text-muted-foreground">Keine Catalog-Einträge vorhanden.</p>
          )}
          {(state.catalog || []).map((c: any) => (
            <div key={c.id} className="rounded-lg border p-3">
              <div className="font-medium text-sm">{c.canonical_title}</div>
              <div className="flex gap-2 mt-1 flex-wrap">
                <Badge variant="outline">{c.education_type}</Badge>
                <Badge variant="secondary">{c.award_type}</Badge>
                {c.provider_family && <Badge>{c.provider_family}</Badge>}
                {c.qualification_level && <Badge variant="outline">{c.qualification_level}</Badge>}
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="drafts" className="space-y-2 mt-3">
          {(state.drafts || []).length === 0 && (
            <p className="text-sm text-muted-foreground">Keine Ready Drafts vorhanden.</p>
          )}
          {(state.drafts || []).map((d: any) => (
            <div key={d.draft_id} className="rounded-lg border p-3">
              <div className="font-medium text-sm">{d.draft_title}</div>
              <div className="flex gap-2 mt-1 flex-wrap">
                <Badge variant="outline">{d.education_type}</Badge>
                {d.award_type && <Badge variant="secondary">{d.award_type}</Badge>}
                <span className="text-xs text-muted-foreground">
                  Readiness {d.readiness_score} · {d.status}
                </span>
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="wave" className="space-y-2 mt-3">
          {(state.waveCandidates || []).length === 0 && (
            <p className="text-sm text-muted-foreground">Keine Wave-Kandidaten vorhanden.</p>
          )}
          {(state.waveCandidates || []).map((c: any) => (
            <div key={c.id} className="rounded-lg border p-3">
              <div className="font-medium text-sm">
                {c.qualification_catalog?.canonical_title || c.qualification_catalog_id}
              </div>
              <div className="flex gap-2 mt-1 flex-wrap">
                {c.award_type && <Badge variant="outline">{c.award_type}</Badge>}
                {c.provider_family && <Badge variant="secondary">{c.provider_family}</Badge>}
                <span className="text-xs text-muted-foreground">
                  Readiness {c.readiness_score} · Priority {c.promotion_priority}
                </span>
              </div>
            </div>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
