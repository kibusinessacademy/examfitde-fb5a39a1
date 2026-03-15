import { useState } from "react";
import { AdminShell } from "@/components/admin/layout/AdminShell";
import { AdminSectionHeader } from "@/components/admin/layout/AdminSectionHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { runV2LoopSmokeTest } from "@/integrations/supabase/admin-ops-actions";
import { useToast } from "@/hooks/use-toast";
import { Activity, AlertTriangle, CheckCircle, Clock, FlaskConical, Zap } from "lucide-react";

interface SmokeResult {
  ok: boolean;
  target_user_id: string;
  curriculum_id: string;
  dry_run: boolean;
  events_written: number;
  snapshot_created: boolean;
  snapshot_debounced: boolean;
  readiness_score: number;
  risk_level: string;
  confidence_score: number;
  competency_breakdown: { total: number; mastered: number; partial: number; not_mastered: number };
  active_recommendations_count: number;
  latest_generation_id: string;
  latest_snapshot: Record<string, unknown> | null;
  last_learning_events: Array<Record<string, unknown>>;
  active_recommendations: Array<Record<string, unknown>>;
  top_gaps: Array<Record<string, unknown>>;
  view_current_readiness: Record<string, unknown> | null;
  elapsed_ms: number;
  [key: string]: unknown;
}

const RISK_COLORS: Record<string, string> = {
  exam_ready: "bg-emerald-500/20 text-emerald-700 border-emerald-500/30",
  on_track: "bg-blue-500/20 text-blue-700 border-blue-500/30",
  medium_risk: "bg-amber-500/20 text-amber-700 border-amber-500/30",
  high_risk: "bg-destructive/20 text-destructive border-destructive/30",
};

export default function V2LoopDebugPage() {
  const [curriculumId, setCurriculumId] = useState("");
  const [userId, setUserId] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SmokeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const runTest = async () => {
    if (!curriculumId.trim()) {
      toast({ title: "Curriculum-ID erforderlich", variant: "destructive" });
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await runV2LoopSmokeTest(curriculumId.trim(), userId.trim() || undefined, dryRun);
      setResult(data as SmokeResult);
      toast({ title: "Smoke Test abgeschlossen", description: `${data.elapsed_ms}ms` });
    } catch (e) {
      setError((e as Error).message);
      toast({ title: "Fehler", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminShell>
      <AdminSectionHeader
        title="v2 Intelligence Loop — Smoke Test"
        subtitle="Deterministischer Testpfad: Events → Snapshot → Recommendations → Views"
      />

      {/* Input Form */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="curriculum">Curriculum ID *</Label>
              <Input
                id="curriculum"
                value={curriculumId}
                onChange={(e) => setCurriculumId(e.target.value)}
                placeholder="uuid..."
                className="mt-1 font-mono text-xs"
              />
            </div>
            <div>
              <Label htmlFor="user">User ID (optional, default: eigener)</Label>
              <Input
                id="user"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="uuid... (optional)"
                className="mt-1 font-mono text-xs"
              />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={runTest} disabled={loading} className="gap-2">
                <FlaskConical className="h-4 w-4" />
                {loading ? "Läuft..." : "Smoke Test starten"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDryRun(!dryRun)}
                className={dryRun ? "border-amber-500 text-amber-600" : ""}
              >
                {dryRun ? "Dry Run AN" : "Dry Run AUS"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading && <Skeleton className="h-64 w-full" />}

      {error && (
        <Card className="border-destructive/30 bg-destructive/5 mb-6">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <span className="font-medium">Fehler:</span> {error}
            </div>
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="space-y-4">
          {/* Health Summary */}
          <div className="grid gap-4 sm:grid-cols-4">
            <SummaryCard
              icon={<Zap className="h-5 w-5" />}
              label="Readiness Score"
              value={result.readiness_score != null ? `${result.readiness_score}%` : "—"}
              badge={result.risk_level}
              badgeClass={RISK_COLORS[result.risk_level] || ""}
            />
            <SummaryCard
              icon={<Activity className="h-5 w-5" />}
              label="Events geschrieben"
              value={String(result.events_written ?? 0)}
            />
            <SummaryCard
              icon={<CheckCircle className="h-5 w-5" />}
              label="Snapshot"
              value={result.snapshot_created ? "Erstellt ✓" : result.snapshot_debounced ? "Debounced" : "—"}
            />
            <SummaryCard
              icon={<Clock className="h-5 w-5" />}
              label="Dauer"
              value={`${result.elapsed_ms}ms`}
            />
          </div>

          {/* Competency Breakdown */}
          {result.competency_breakdown && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Kompetenz-Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-4 text-center text-sm">
                  <div>
                    <div className="text-2xl font-bold text-foreground">{result.competency_breakdown.total}</div>
                    <div className="text-muted-foreground">Gesamt</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-emerald-600">{result.competency_breakdown.mastered}</div>
                    <div className="text-muted-foreground">Gemeistert</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-amber-600">{result.competency_breakdown.partial}</div>
                    <div className="text-muted-foreground">Teilweise</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-destructive">{result.competency_breakdown.not_mastered}</div>
                    <div className="text-muted-foreground">Nicht gemeistert</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recommendations */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">
                Aktive Empfehlungen ({result.active_recommendations_count})
                {result.latest_generation_id && (
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    gen:{result.latest_generation_id?.slice(0, 8)}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {result.active_recommendations?.length ? (
                <div className="space-y-2">
                  {result.active_recommendations.map((rec: Record<string, unknown>, i: number) => (
                    <div key={i} className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{String(rec.recommendation_type)}</Badge>
                        <span className="text-foreground">{String(rec.reason_text || "")}</span>
                      </div>
                      <span className="font-mono text-xs text-muted-foreground">P:{String(rec.priority_score)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Keine aktiven Empfehlungen</p>
              )}
            </CardContent>
          </Card>

          {/* Learning Events */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Letzte Learning Events</CardTitle>
            </CardHeader>
            <CardContent>
              {result.last_learning_events?.length ? (
                <div className="space-y-1">
                  {result.last_learning_events.map((evt: Record<string, unknown>, i: number) => (
                    <div key={i} className="flex items-center justify-between text-xs font-mono">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">{String(evt.event_type)}</Badge>
                        <span className="text-muted-foreground">{String(evt.event_source)}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {evt.score != null && <span>Score: {String(evt.score)}</span>}
                        <span className="text-muted-foreground">{String(evt.created_at).slice(0, 19)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Keine Events vorhanden</p>
              )}
            </CardContent>
          </Card>

          {/* Latest Snapshot */}
          {result.latest_snapshot && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Letzter Snapshot</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="rounded-lg bg-muted p-3 text-xs font-mono text-foreground overflow-auto max-h-48">
                  {JSON.stringify(result.latest_snapshot, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}

          {/* Raw JSON (collapsible) */}
          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              Raw JSON Readout
            </summary>
            <pre className="p-4 text-xs font-mono text-foreground overflow-auto max-h-96 bg-muted/50">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </AdminShell>
  );
}

function SummaryCard({ icon, label, value, badge, badgeClass }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  badge?: string;
  badgeClass?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-6">
        <div className="text-muted-foreground">{icon}</div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-bold text-foreground">{value}</div>
          {badge && (
            <Badge variant="outline" className={`mt-1 text-[10px] ${badgeClass}`}>
              {badge}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
