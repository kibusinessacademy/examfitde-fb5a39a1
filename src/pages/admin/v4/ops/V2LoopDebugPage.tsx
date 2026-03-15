import { useState } from "react";
import { PlayCircle, Activity, CheckCircle2, AlertTriangle, Brain, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { runV2LoopSmokeTest } from "@/lib/admin/runV2LoopSmokeTest";

type GenericRecord = Record<string, unknown>;

type SmokeResult = {
  ok: boolean;
  target_user_id: string;
  curriculum_id: string;
  dry_run: boolean;
  readiness_score?: number;
  risk_level?: string;
  confidence_score?: number;
  events_written?: number;
  snapshot_created?: boolean;
  snapshot_debounced?: boolean;
  recommendations_generated?: number;
  latest_generation_id?: string;
  latest_snapshot?: GenericRecord | null;
  competency_breakdown?: {
    total: number;
    mastered: number;
    partial: number;
    not_mastered: number;
  };
  last_learning_events: Array<GenericRecord>;
  active_recommendations: Array<GenericRecord>;
  active_recommendations_count: number;
  top_gaps: Array<GenericRecord>;
  view_current_readiness: GenericRecord | null;
  elapsed_ms: number;
  [key: string]: unknown;
};

const RISK_COLORS: Record<string, string> = {
  exam_ready: "bg-emerald-500/20 text-emerald-700 border-emerald-500/30",
  on_track: "bg-blue-500/20 text-blue-700 border-blue-500/30",
  medium_risk: "bg-amber-500/20 text-amber-700 border-amber-500/30",
  high_risk: "bg-destructive/20 text-destructive border-destructive/30",
};

function MetricCard({
  icon,
  label,
  value,
  badge,
  badgeClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  badge?: string;
  badgeClass?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-2xl font-semibold">{value}</div>
          {badge ? <Badge className={badgeClass}>{badge}</Badge> : null}
        </div>
      </CardContent>
    </Card>
  );
}

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
      const data = await runV2LoopSmokeTest(
        curriculumId.trim(),
        userId.trim() || undefined,
        dryRun,
      );
      setResult(data as SmokeResult);
      toast({
        title: "Smoke Test abgeschlossen",
        description: `${data.elapsed_ms}ms`,
      });
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast({ title: "Fehler", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">V2 Loop Debug</h1>
        <p className="text-sm text-muted-foreground">
          Smoke Test für Learning Events → Readiness Snapshot → Recommendations → Views
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Smoke Test starten</CardTitle>
          <CardDescription>
            Führt den V2-Loop gezielt für ein Curriculum aus und liest die Resultate direkt zurück.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Curriculum ID *</Label>
              <Input
                value={curriculumId}
                onChange={(e) => setCurriculumId(e.target.value)}
                placeholder="uuid..."
                className="mt-1 font-mono text-xs"
              />
            </div>
            <div>
              <Label>User ID (optional, default: eigener User)</Label>
              <Input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="uuid... (optional)"
                className="mt-1 font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center space-x-2">
              <Switch checked={dryRun} onCheckedChange={setDryRun} />
              <Label>Dry Run</Label>
            </div>

            <Button onClick={runTest} disabled={loading}>
              <PlayCircle className="mr-2 h-4 w-4" />
              {loading ? "Läuft..." : "Smoke Test starten"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card>
          <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Activity className="h-4 w-4 animate-spin" />
            Smoke Test läuft…
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="p-6 text-sm text-destructive">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" />
              Fehler: {error}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {result ? (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard
              icon={<Brain className="h-4 w-4" />}
              label="Readiness Score"
              value={result.readiness_score != null ? `${result.readiness_score}%` : "—"}
              badge={result.risk_level}
              badgeClass={result.risk_level ? (RISK_COLORS[result.risk_level] || "") : ""}
            />
            <MetricCard
              icon={<CheckCircle2 className="h-4 w-4" />}
              label="Events geschrieben"
              value={String(result.events_written ?? 0)}
            />
            <MetricCard
              icon={<CheckCircle2 className="h-4 w-4" />}
              label="Snapshot"
              value={
                result.snapshot_created
                  ? "Erstellt ✓"
                  : result.snapshot_debounced
                  ? "Debounced"
                  : "—"
              }
            />
            <MetricCard
              icon={<Clock3 className="h-4 w-4" />}
              label="Dauer"
              value={`${result.elapsed_ms}ms`}
            />
          </div>

          {result.competency_breakdown ? (
            <Card>
              <CardHeader>
                <CardTitle>Kompetenz-Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="rounded-lg border p-4 text-center">
                    <div className="text-2xl font-semibold">{result.competency_breakdown.total}</div>
                    <div className="text-sm text-muted-foreground">Gesamt</div>
                  </div>
                  <div className="rounded-lg border p-4 text-center">
                    <div className="text-2xl font-semibold">{result.competency_breakdown.mastered}</div>
                    <div className="text-sm text-muted-foreground">Gemeistert</div>
                  </div>
                  <div className="rounded-lg border p-4 text-center">
                    <div className="text-2xl font-semibold">{result.competency_breakdown.partial}</div>
                    <div className="text-sm text-muted-foreground">Teilweise</div>
                  </div>
                  <div className="rounded-lg border p-4 text-center">
                    <div className="text-2xl font-semibold">{result.competency_breakdown.not_mastered}</div>
                    <div className="text-sm text-muted-foreground">Nicht gemeistert</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>
                  Aktive Empfehlungen ({result.active_recommendations_count})
                </CardTitle>
                <CardDescription>
                  {result.latest_generation_id
                    ? `Generation ${result.latest_generation_id.slice(0, 8)}`
                    : "Keine Generation-ID"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {result.active_recommendations?.length ? (
                  <div className="space-y-3">
                    {result.active_recommendations.map((rec: GenericRecord, i: number) => (
                      <div key={i} className="rounded-lg border p-3">
                        <div className="flex items-center justify-between gap-3">
                          <Badge variant="outline">
                            {String(rec.recommendation_type || "unknown")}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            P:{String(rec.priority_score ?? "—")}
                          </span>
                        </div>
                        <div className="mt-2 text-sm">
                          {String(rec.reason_text || "")}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Keine aktiven Empfehlungen
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Letzte Learning Events</CardTitle>
              </CardHeader>
              <CardContent>
                {result.last_learning_events?.length ? (
                  <div className="space-y-3">
                    {result.last_learning_events.map((evt: GenericRecord, i: number) => (
                      <div key={i} className="rounded-lg border p-3">
                        <div className="flex items-center justify-between gap-3">
                          <Badge variant="secondary">
                            {String(evt.event_type || "unknown")}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {String(evt.created_at || "").slice(0, 19)}
                          </span>
                        </div>
                        <div className="mt-2 text-sm text-muted-foreground">
                          Source: {String(evt.event_source || "—")}
                          {evt.score != null ? ` · Score: ${String(evt.score)}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Keine Learning Events gefunden
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Top Gaps</CardTitle>
            </CardHeader>
            <CardContent>
              {result.top_gaps?.length ? (
                <div className="space-y-2">
                  {result.top_gaps.map((gap: GenericRecord, i: number) => (
                    <div key={i} className="rounded-lg border p-3 text-sm">
                      <div className="font-medium">{String(gap.competency_title || gap.title || "—")}</div>
                      <div className="text-muted-foreground">
                        Score: {String(gap.score ?? "—")} · Gewicht: {String(gap.weight ?? "—")}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Keine Gaps gefunden</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Readback / Snapshot / Debug JSON</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-[600px] overflow-auto rounded-lg bg-muted p-4 text-xs">
                {JSON.stringify(result, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
