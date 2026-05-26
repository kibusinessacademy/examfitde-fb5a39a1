/**
 * Berufs-KI Business Intelligence Page (BK-Act-4).
 *
 * Ausbildungsleiter-Cockpit:
 *  1. Team Readiness Heatmap
 *  2. Risk Radar
 *  3. Team AI Impact
 *  4. Intervention Recommendations
 *  5. Training Quality Score
 *
 * Alle Werte: deterministisch aggregiert aus workflow_outcomes via manager_*-RPCs.
 * Niemals client-seitige Berechnung.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, ArrowRight, Clock, GaugeCircle,
  ShieldAlert, Sparkles, Users, BarChart3,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { bandClass, OUTCOME_TYPE_SHORT } from "@/lib/berufs-ki/bi";
import {
  useTeamReadinessHeatmap, useRiskRadar, useTeamAiImpact,
  useInterventionRecommendations, useTrainingQualityScore,
} from "@/hooks/useManagerBI";

interface OrgOption { id: string; name: string; role: string }

function useManagerOrgs() {
  return useQuery({
    queryKey: ["bki-bi", "manager-orgs"],
    queryFn: async (): Promise<OrgOption[]> => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return [];
      const { data, error } = await supabase
        .from("org_memberships")
        .select("org_id, role, organizations(id, name)")
        .eq("user_id", user.user.id)
        .eq("status", "active")
        .in("role", ["owner", "admin", "manager"]);
      if (error) throw error;
      return (data ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((row: any) => ({
          id: row.organizations?.id ?? row.org_id,
          name: row.organizations?.name ?? "Organisation",
          role: row.role,
        }))
        .filter((o) => !!o.id);
    },
    staleTime: 60_000,
  });
}

export default function BerufsKIIntelligencePage() {
  const { data: orgs, isLoading: orgsLoading } = useManagerOrgs();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    if (orgs && orgs.length > 0 && !orgId) setOrgId(orgs[0].id);
  }, [orgs, orgId]);

  if (orgsLoading) {
    return <div className="container py-10 text-sm text-muted-foreground">Lade Ausbildungs-Cockpit…</div>;
  }

  if (!orgs || orgs.length === 0) {
    return (
      <div className="container py-10">
        <Card>
          <CardContent className="p-6 text-sm">
            <div className="mb-2 font-semibold">Ausbildungs-Intelligence verfügbar mit Manager-Rolle.</div>
            <p className="text-muted-foreground">
              Du benötigst eine Owner-, Admin- oder Manager-Rolle in einer Organisation,
              um Team-Heatmap, Risiko-Radar und Interventions-Empfehlungen zu sehen.
            </p>
            <Button asChild className="mt-4" size="sm">
              <Link to="/work">Business-Lizenz prüfen</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container space-y-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-primary">Berufs-KI · Ausbildungs-Intelligence</div>
          <h1 className="text-2xl font-bold leading-tight">Cockpit für Ausbildungsleiter</h1>
          <p className="text-sm text-muted-foreground">
            Deterministische Wirkung statt Activity-Logs — Heatmap, Frühwarnsystem, Empfehlungen.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/berufs-ki/intelligence/executive">Executive-Cockpit<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link>
          </Button>
          <Select value={orgId ?? undefined} onValueChange={setOrgId}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Organisation" /></SelectTrigger>
            <SelectContent>
              {orgs.map((o) => (
                <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 Tage</SelectItem>
              <SelectItem value="30">30 Tage</SelectItem>
              <SelectItem value="90">90 Tage</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <QualityScoreCard orgId={orgId} days={days} />
        <AiImpactCard orgId={orgId} days={days} />
      </div>

      <RiskRadarCard orgId={orgId} days={days} />
      <HeatmapCard orgId={orgId} days={days} />
      <InterventionsCard orgId={orgId} days={days} />
    </div>
  );
}

/* ------------------------ Cards ------------------------ */

function isErr<T>(x: T | { error: string } | null | undefined): x is { error: string } {
  return !!x && typeof x === "object" && "error" in (x as Record<string, unknown>);
}

function QualityScoreCard({ orgId, days }: { orgId: string | null; days: number }) {
  const { data, isLoading } = useTrainingQualityScore(orgId, days);
  if (isLoading || !data) return <SkeletonCard title="Ausbildungsqualität" />;
  if (isErr(data)) return <ErrorCard title="Ausbildungsqualität" message={data.error} />;

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-background">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <GaugeCircle className="h-4 w-4 text-primary" />
          Ausbildungsqualitäts-Score
          <Badge variant="outline" className={`ml-auto text-[10px] ${bandClass(data.band)}`}>{data.band.toUpperCase()}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline gap-3">
          <div className="text-4xl font-bold text-primary">{Math.round(data.training_quality_score)}</div>
          <div className="text-xs text-muted-foreground">
            / 100 · {data.active_learners}/{data.total_learners} aktive Azubis
          </div>
        </div>
        <Progress value={data.training_quality_score} className="h-2" aria-label="Quality Score" />
        <div className="grid grid-cols-2 gap-2 text-xs">
          {data.breakdown.map((b) => (
            <div key={b.key} className="rounded-md border bg-card p-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">{b.label}</span>
                <span className="text-muted-foreground">{b.weight_pct}%</span>
              </div>
              <div className="mt-0.5 text-sm font-semibold">{b.value}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AiImpactCard({ orgId, days }: { orgId: string | null; days: number }) {
  const { data, isLoading } = useTeamAiImpact(orgId, days);
  if (isLoading || !data) return <SkeletonCard title="Team AI Impact" />;
  if (isErr(data)) return <ErrorCard title="Team AI Impact" message={data.error} />;

  const stats = [
    { icon: Clock,       label: "Std. gespart",          value: `${data.hours_saved}h` },
    { icon: BarChart3,   label: "Analysen automatisiert", value: data.analyses_automated },
    { icon: Sparkles,    label: "Risiko-Signale",         value: data.risk_signals_detected },
    { icon: Activity,    label: "Aktive Azubis",          value: data.active_learners },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" /> Team AI Impact
          <Badge variant="secondary" className="ml-auto text-[10px]">{data.workflows_run} Runs</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border bg-card p-3">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <s.icon className="h-4 w-4" />
                <span className="text-[10px] uppercase tracking-wide">{s.label}</span>
              </div>
              <div className="mt-1 text-lg font-semibold">{s.value}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Zeitersparnis und Risiko-Signale basieren auf abgeschlossenen Workflow-Outcomes (deterministisch).
        </p>
      </CardContent>
    </Card>
  );
}

function RiskRadarCard({ orgId, days }: { orgId: string | null; days: number }) {
  const { data, isLoading } = useRiskRadar(orgId, days);
  if (isLoading || !data) return <SkeletonCard title="Ausbildungsrisiko-Radar" />;
  if (isErr(data)) return <ErrorCard title="Ausbildungsrisiko-Radar" message={data.error} />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-primary" /> Ausbildungsrisiko-Radar
          <Badge variant="secondary" className="ml-auto text-[10px]">{data.total_learners} Azubis</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {data.dimensions.map((d) => {
            const pct = d.total > 0 ? Math.round((d.value / d.total) * 100) : 0;
            const band = pct >= 30 ? "red" : pct >= 15 ? "amber" : "green";
            return (
              <div key={d.key} className={`rounded-lg border p-3 ${bandClass(band)}`}>
                <div className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{d.label}</div>
                <div className="mt-1 text-2xl font-bold">{d.value}</div>
                <div className="text-[11px] opacity-80">von {d.total} ({pct}%)</div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function HeatmapCard({ orgId, days }: { orgId: string | null; days: number }) {
  const { data, isLoading } = useTeamReadinessHeatmap(orgId, days);
  const cols = useMemo(() => (data && !isErr(data) ? data.columns : []), [data]);
  if (isLoading || !data) return <SkeletonCard title="Team Readiness Heatmap" />;
  if (isErr(data)) return <ErrorCard title="Team Readiness Heatmap" message={data.error} />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-primary" /> Team Readiness Heatmap
          <Badge variant="secondary" className="ml-auto text-[10px]">{data.rows.length} Azubis</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine aktiven Azubis in dieser Organisation.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="px-2 py-1.5 font-medium">Azubi</th>
                  <th className="px-2 py-1.5 font-medium">Score</th>
                  {cols.map((c) => (
                    <th key={c} className="px-2 py-1.5 font-medium">{OUTCOME_TYPE_SHORT[c] ?? c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.user_id} className="border-t">
                    <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground">{r.user_id.slice(0, 8)}…</td>
                    <td className="px-2 py-1.5">
                      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border ${bandClass(r.overall_band)}`}>
                        {r.overall_score ?? "–"}
                      </span>
                    </td>
                    {cols.map((c) => {
                      const cell = r.cells[c];
                      if (!cell) return <td key={c} className="px-2 py-1.5 text-muted-foreground">–</td>;
                      return (
                        <td key={c} className="px-2 py-1.5">
                          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border ${bandClass(cell.band)}`}>
                            {Math.round(cell.avg_score)}
                          </span>
                          <span className="ml-1 text-[10px] text-muted-foreground">{cell.runs}×</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InterventionsCard({ orgId, days }: { orgId: string | null; days: number }) {
  const { data, isLoading } = useInterventionRecommendations(orgId, days);
  if (isLoading || !data) return <SkeletonCard title="Empfohlene Interventionen" />;
  if (isErr(data)) return <ErrorCard title="Empfohlene Interventionen" message={data.error} />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-primary" /> Empfohlene Interventionen
          <Badge variant="secondary" className="ml-auto text-[10px]">{data.recommendations.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.recommendations.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aktuell keine Interventionen nötig — das Team ist auf Kurs.</p>
        ) : (
          <ul className="space-y-2">
            {data.recommendations.map((r) => (
              <li key={r.key} className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-3">
                <Badge
                  variant="outline"
                  className={`text-[10px] uppercase ${
                    r.severity === "high"
                      ? "bg-status-error-bg-subtle text-status-error-text border-status-error-border"
                      : r.severity === "medium"
                      ? "bg-status-warning-bg-subtle text-status-warning-text border-status-warning-border"
                      : "bg-status-info-bg-subtle text-status-info-text border-status-info-border"
                  }`}
                >
                  {r.severity}
                </Badge>
                <div className="flex-1">
                  <div className="text-sm font-semibold">{r.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{r.detail}</div>
                </div>
                {r.action_target ? (
                  <Button asChild size="sm">
                    <Link to={r.action_target}>{r.action_label}<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link>
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled>{r.action_label}</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SkeletonCard({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent><div className="h-20 animate-pulse rounded-md bg-muted/30" /></CardContent>
    </Card>
  );
}
function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent><p className="text-sm text-status-error-text">{message}</p></CardContent>
    </Card>
  );
}
