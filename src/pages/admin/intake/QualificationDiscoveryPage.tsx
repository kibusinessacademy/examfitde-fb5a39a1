import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, RefreshCw } from "lucide-react";

export default function QualificationDiscoveryPage() {
  const [state, setState] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [cronRunning, setCronRunning] = useState(false);

  async function load() {
    setLoading(true);
    const [statusRes, waveRes] = await Promise.all([
      supabase.functions.invoke("qualification-intake-admin", { body: { action: "status" } }),
      supabase.functions.invoke("qualification-intake-admin", { body: { action: "wave_candidates" } }),
    ]);
    setState({
      status: statusRes.data,
      waveCandidates: waveRes.data?.candidates || [],
    });
    setLoading(false);
  }

  async function runCron() {
    setCronRunning(true);
    await supabase.functions.invoke("qualification-intake-admin", {
      body: { action: "run_cron" },
    });
    await load();
    setCronRunning(false);
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Qualification Discovery & Promotion</h1>
          <p className="text-sm text-muted-foreground">
            Search → Fetch → Parse → Draft → Materialize → Wave Candidate
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={runCron} disabled={cronRunning}>
            {cronRunning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
            Intake-Cron ausführen
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Search Runs</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{state.status?.search_runs ?? "–"}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Candidates</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{state.status?.candidates ?? "–"}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Pending Fetches</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{state.status?.pending_fetches ?? "–"}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Catalog Entries</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{state.status?.catalog_entries ?? "–"}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Wave Candidates ({state.waveCandidates?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
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
                  Readiness {c.readiness_score} · Market {c.market_score} · Priority {c.promotion_priority}
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
