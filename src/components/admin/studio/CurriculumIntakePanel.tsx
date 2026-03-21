import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, RefreshCw, Database, FileText, CheckCircle, XCircle } from "lucide-react";

type IntakeStats = {
  discovered: number;
  downloaded: number;
  parsed: number;
  promoted: number;
  rejected: number;
  pending_jobs: number;
  sources: number;
};

export default function CurriculumIntakePanel() {
  const [stats, setStats] = useState<IntakeStats | null>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [cronRunning, setCronRunning] = useState(false);

  async function load() {
    setLoading(true);
    const sb = supabase;

    const [discovered, downloaded, parsed, promoted, rejected, pendingJobs, sources, candidateList] =
      await Promise.all([
        sb.from("curriculum_intake_candidates").select("id", { count: "exact", head: true }).eq("intake_status", "discovered"),
        sb.from("curriculum_intake_candidates").select("id", { count: "exact", head: true }).eq("intake_status", "downloaded"),
        sb.from("curriculum_intake_candidates").select("id", { count: "exact", head: true }).eq("intake_status", "parsed"),
        sb.from("curriculum_intake_candidates").select("id", { count: "exact", head: true }).eq("intake_status", "promoted"),
        sb.from("curriculum_intake_candidates").select("id", { count: "exact", head: true }).eq("intake_status", "rejected"),
        sb.from("curriculum_intake_jobs").select("id", { count: "exact", head: true }).eq("status", "pending"),
        sb.from("curriculum_source_registry").select("id", { count: "exact", head: true }).eq("is_enabled", true),
        sb.from("curriculum_intake_candidates").select("*").order("discovered_at", { ascending: false }).limit(50),
      ]);

    setStats({
      discovered: discovered.count ?? 0,
      downloaded: downloaded.count ?? 0,
      parsed: parsed.count ?? 0,
      promoted: promoted.count ?? 0,
      rejected: rejected.count ?? 0,
      pending_jobs: pendingJobs.count ?? 0,
      sources: sources.count ?? 0,
    });
    setCandidates(candidateList.data || []);
    setLoading(false);
  }

  async function runCron() {
    setCronRunning(true);
    await supabase.functions.invoke("curriculum-intake-cron", {
      body: { discover: true, download: true, parse: true, promote: true },
    });
    await load();
    setCronRunning(false);
  }

  useEffect(() => { load(); }, []);

  const statusColor = (s: string) => {
    switch (s) {
      case "discovered": return "secondary";
      case "downloaded": return "outline";
      case "parsed": return "default";
      case "promoted": return "default";
      case "rejected": return "destructive";
      default: return "secondary";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Curriculum Intake Engine</h1>
          <p className="text-sm text-muted-foreground">
            Discover → Download → Parse → Promote → Factory
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={runCron} disabled={cronRunning}>
            {cronRunning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
            Intake Cron starten
          </Button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs">Sources</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-semibold flex items-center gap-1"><Database className="h-4 w-4" />{stats.sources}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs">Discovered</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-semibold">{stats.discovered}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs">Downloaded</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-semibold">{stats.downloaded}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs">Parsed</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-semibold flex items-center gap-1"><FileText className="h-4 w-4" />{stats.parsed}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs">Promoted</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-semibold flex items-center gap-1"><CheckCircle className="h-4 w-4 text-primary" />{stats.promoted}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs">Rejected</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-semibold flex items-center gap-1"><XCircle className="h-4 w-4 text-destructive" />{stats.rejected}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs">Pending Jobs</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-semibold">{stats.pending_jobs}</div></CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent Candidates ({candidates.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {candidates.length === 0 && (
            <p className="text-sm text-muted-foreground">Keine Kandidaten vorhanden. Starte den Intake Cron.</p>
          )}
          {candidates.map((c: any) => (
            <div key={c.id} className="rounded-lg border p-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate">{c.canonical_title || c.title_raw}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {c.provider_name} · {c.category} · {c.source_key}
                </div>
              </div>
              <Badge variant={statusColor(c.intake_status) as any}>{c.intake_status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
