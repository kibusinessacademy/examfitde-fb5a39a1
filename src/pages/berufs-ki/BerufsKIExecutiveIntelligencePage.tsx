/**
 * BK-Act-5.2 — Cross-Org Intelligence (Executive Page).
 *
 * Route: /berufs-ki/intelligence/executive
 *
 * Erweitert die BI-Layer (BK-Act-4) um organisationsweite Sicht:
 *  - Cross-Org Quality Score + Insights (Top-Standort, kritischste Cohort)
 *  - Standort-Vergleich (rank-ordered)
 *  - Cohort-Trends (current vs previous window)
 *  - Recovery-Effectiveness (by Site / Cohort)
 *  - Intervention Impact (welche Maßnahmen wirken?)
 *  - Competency Cluster Risk (wo entstehen Risiken?)
 *
 * Alle Werte deterministisch — Server-side role-scoped via fn_org_visible_user_ids.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Building2, Layers, LineChart, ShieldCheck, Target, Trophy, AlertOctagon, ArrowLeft,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useCrossOrgReadiness, useSiteComparison, useCohortTrends,
  useRecoveryEffectiveness, useInterventionImpact, useClusterRisk, useOrgQuality,
} from "@/hooks/useCrossOrgIntel";
import { useExecutiveNarrative } from "@/hooks/useBerufsKIActivation";
import { bandClass, trendLabel, interventionLabel, type Band } from "@/lib/berufs-ki/crossOrg";
import { OUTCOME_TYPE_SHORT } from "@/lib/berufs-ki/bi";

interface OrgOption { id: string; name: string; role: string }

function useManagerOrgs() {
  return useQuery({
    queryKey: ["xo", "manager-orgs"],
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((r: any) => ({
        id: r.organizations?.id ?? r.org_id,
        name: r.organizations?.name ?? "Organisation",
        role: r.role,
      })).filter((o) => !!o.id);
    },
    staleTime: 60_000,
  });
}

function isErr<T>(x: T | { error: string } | null | undefined): x is { error: string } {
  return !!x && typeof x === "object" && "error" in (x as Record<string, unknown>);
}

export default function BerufsKIExecutiveIntelligencePage() {
  const { data: orgs, isLoading } = useManagerOrgs();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => { if (orgs && orgs.length && !orgId) setOrgId(orgs[0].id); }, [orgs, orgId]);

  if (isLoading) return <div className="container py-10 text-sm text-muted-foreground">Lade Executive-Cockpit…</div>;
  if (!orgs?.length) {
    return (
      <div className="container py-10">
        <Card><CardContent className="p-6 text-sm">
          <div className="mb-2 font-semibold">Executive Intelligence erfordert Manager-Rolle.</div>
          <p className="text-muted-foreground">
            Owner-, Admin- oder Manager-Rolle in einer Organisation erforderlich.
          </p>
          <Button asChild className="mt-4" size="sm"><Link to="/berufs-ki/intelligence">Zurück zum Team-Cockpit</Link></Button>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="container space-y-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-primary">
            Berufs-KI · Workforce Intelligence
          </div>
          <h1 className="text-2xl font-bold leading-tight">Executive Cockpit</h1>
          <p className="text-sm text-muted-foreground">
            Organisationsweite Ausbildungsleistung — wo entsteht Risiko, welche Maßnahmen wirken?
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/berufs-ki/intelligence"><ArrowLeft className="mr-1 h-4 w-4" />Team-Cockpit</Link>
          </Button>
          <Select value={orgId ?? undefined} onValueChange={setOrgId}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Organisation" /></SelectTrigger>
            <SelectContent>
              {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
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

      <ExecutiveNarrativeCard orgId={orgId} days={days} />

      <OrgQualityCard orgId={orgId} days={days} />

      <div className="grid gap-6 lg:grid-cols-2">
        <SiteComparisonCard orgId={orgId} days={days} />
        <RecoveryEffectivenessCard orgId={orgId} days={days} />
      </div>

      <CohortTrendCard orgId={orgId} days={days} />

      <div className="grid gap-6 lg:grid-cols-2">
        <InterventionImpactCard orgId={orgId} days={days} />
        <ClusterRiskCard orgId={orgId} days={days} />
      </div>

      <CrossOrgReadinessCard orgId={orgId} days={days} />
    </div>
  );
}

/* ---------- cards ---------- */

function BandPill({ band, children }: { band: Band | undefined; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border ${bandClass(band)}`}>
      {children}
    </span>
  );
}

function Skel({ title }: { title: string }) {
  return (
    <Card><CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent><div className="h-20 animate-pulse rounded-md bg-muted/30" /></CardContent>
    </Card>
  );
}

function Err({ title, message }: { title: string; message: string }) {
  return (
    <Card><CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent><p className="text-sm text-status-error-text">{message}</p></CardContent>
    </Card>
  );
}

function OrgQualityCard({ orgId, days }: { orgId: string | null; days: number }) {
  const { data, isLoading } = useOrgQuality(orgId, days);
  if (isLoading || !data) return <Skel title="Org Training Quality Score" />;
  if (isErr(data)) return <Err title="Org Training Quality Score" message={data.error} />;

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-background">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4 text-primary" />
          Org Training Quality Score
          <Badge variant="outline" className={`ml-auto text-[10px] ${bandClass(data.band)}`}>{data.band.toUpperCase()}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <div className="text-4xl font-bold text-primary">{Math.round(data.org_training_quality_score)}</div>
          <div className="text-xs text-muted-foreground">
            / 100 · {data.active_learners}/{data.total_learners} aktive Azubis (org-weit)
          </div>
        </div>
        <Progress value={data.org_training_quality_score} className="h-2" aria-label="Org Quality Score" />
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
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
        <div className="grid gap-2 sm:grid-cols-2">
          {data.insights.top_site && (
            <div className="rounded-lg border bg-card p-3">
              <div className="flex items-center gap-1.5 text-status-success-text">
                <Trophy className="h-4 w-4" />
                <span className="text-[10px] uppercase font-semibold tracking-wide">Stärkster Standort</span>
              </div>
              <div className="mt-1 font-semibold">{data.insights.top_site.name}</div>
              <div className="text-xs text-muted-foreground">Ø Score {data.insights.top_site.avg_score}</div>
            </div>
          )}
          {data.insights.critical_cohort && (
            <div className="rounded-lg border bg-card p-3">
              <div className="flex items-center gap-1.5 text-status-error-text">
                <AlertOctagon className="h-4 w-4" />
                <span className="text-[10px] uppercase font-semibold tracking-wide">Kritischste Cohort</span>
              </div>
              <div className="mt-1 font-semibold">{data.insights.critical_cohort.name}</div>
              <div className="text-xs text-muted-foreground">Ø Score {data.insights.critical_cohort.avg_score}</div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SiteComparisonCard({ orgId, days }: { orgId: string | null; days: number }) {
  const { data, isLoading } = useSiteComparison(orgId, days);
  if (isLoading || !data) return <Skel title="Standort-Vergleich" />;
  if (isErr(data)) return <Err title="Standort-Vergleich" message={data.error} />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-primary" /> Standort-Vergleich
          <Badge variant="secondary" className="ml-auto text-[10px]">{data.rows.length} Standorte</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Standorte angelegt. <Link to="/org/structure" className="text-primary underline">Struktur anlegen</Link></p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="px-2 py-1.5 font-medium">Standort</th>
                  <th className="px-2 py-1.5 font-medium">Score</th>
                  <th className="px-2 py-1.5 font-medium">Aktiv</th>
                  <th className="px-2 py-1.5 font-medium">Risk Red.</th>
                  <th className="px-2 py-1.5 font-medium">Runs</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.site_id} className="border-t">
                    <td className="px-2 py-1.5">
                      <div className="font-medium">{r.name}</div>
                      {r.city && <div className="text-[10px] text-muted-foreground">{r.city}</div>}
                    </td>
                    <td className="px-2 py-1.5"><BandPill band={r.band}>{r.avg_score}</BandPill></td>
                    <td className="px-2 py-1.5">{r.activity_pct ?? 0}%</td>
                    <td className="px-2 py-1.5">{r.avg_risk_reduction ?? 0}%</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{r.runs}</td>
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

function RecoveryEffectivenessCard({ orgId, days }: { orgId: string | null; days: number }) {
  const { data, isLoading } = useRecoveryEffectiveness(orgId, days);
  if (isLoading || !data) return <Skel title="Recovery-Wirkung" />;
  if (isErr(data)) return <Err title="Recovery-Wirkung" message={data.error} />;

  const t = data.total;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" /> Recovery-Wirkung
          <Badge variant="secondary" className="ml-auto text-[10px]">{t?.sample_size ?? 0} Outcomes</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-md border bg-card p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Risk-Reduktion</div>
            <div className="text-lg font-semibold">{t?.avg_risk_reduction ?? 0}%</div>
          </div>
          <div className="rounded-md border bg-card p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Kompetenz Δ</div>
            <div className="text-lg font-semibold">{t?.avg_competency_impact ?? 0}%</div>
          </div>
          <div className="rounded-md border bg-card p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Confidence</div>
            <div className="text-lg font-semibold">{t?.avg_confidence ?? 0}%</div>
          </div>
        </div>
        {data.by_site.length > 0 && (
          <div className="text-xs">
            <div className="mb-1 font-medium text-muted-foreground">Pro Standort</div>
            <ul className="space-y-1">
              {data.by_site.slice(0, 5).map((r) => (
                <li key={r.site_id} className="flex items-center justify-between rounded border bg-card px-2 py-1">
                  <span>{r.name}</span>
                  <BandPill band={r.band}>{r.avg_risk_reduction}% Risk-Red.</BandPill>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CohortTrendCard({ orgId, days }: { orgId: string | null; days: number }) {
  const { data, isLoading } = useCohortTrends(orgId, days);
  if (isLoading || !data) return <Skel title="Cohort-Trends" />;
  if (isErr(data)) return <Err title="Cohort-Trends" message={data.error} />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <LineChart className="h-4 w-4 text-primary" /> Cohort-Trends (vs. Vorperiode)
          <Badge variant="secondary" className="ml-auto text-[10px]">{data.rows.length} Cohorts</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Cohorts angelegt. <Link to="/org/structure" className="text-primary underline">Struktur anlegen</Link></p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="px-2 py-1.5 font-medium">Cohort</th>
                  <th className="px-2 py-1.5 font-medium">Score</th>
                  <th className="px-2 py-1.5 font-medium">Δ</th>
                  <th className="px-2 py-1.5 font-medium">Trend</th>
                  <th className="px-2 py-1.5 font-medium">Aktiv</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const trendClass = r.trend === "improvement"
                    ? "text-status-success-text"
                    : r.trend === "decline" ? "text-status-error-text"
                    : "text-muted-foreground";
                  return (
                    <tr key={r.cohort_id} className="border-t">
                      <td className="px-2 py-1.5">
                        <div className="font-medium">{r.name}</div>
                        {r.profession_key && <div className="text-[10px] text-muted-foreground">{r.profession_key}{r.training_year ? ` · J${r.training_year}` : ""}</div>}
                      </td>
                      <td className="px-2 py-1.5"><BandPill band={r.band}>{r.avg_score}</BandPill></td>
                      <td className={`px-2 py-1.5 font-semibold ${trendClass}`}>{r.delta > 0 ? "+" : ""}{r.delta}</td>
                      <td className={`px-2 py-1.5 ${trendClass}`}>{trendLabel(r.trend)}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{r.active_learners}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InterventionImpactCard({ orgId, days }: { orgId: string | null; days: number }) {
  const { data, isLoading } = useInterventionImpact(orgId, days);
  if (isLoading || !data) return <Skel title="Intervention Impact" />;
  if (isErr(data)) return <Err title="Intervention Impact" message={data.error} />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" /> Intervention Impact
          <Badge variant="secondary" className="ml-auto text-[10px]">{data.rows.length} Maßnahmen</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine empfohlenen Maßnahmen mit Outcome-Signal.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.rows.map((r) => (
              <li key={r.action_key} className="rounded-lg border bg-card p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{interventionLabel(r.action_key)}</span>
                  <BandPill band={r.band}>{r.avg_outcome_score}</BandPill>
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {r.sample_size}× · {r.learners} Azubis · Confidence {r.avg_confidence}% · Risk-Red. {r.avg_risk_reduction}%
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ClusterRiskCard({ orgId, days }: { orgId: string | null; days: number }) {
  const { data, isLoading } = useClusterRisk(orgId, days);
  if (isLoading || !data) return <Skel title="Kompetenz-Cluster-Risiko" />;
  if (isErr(data)) return <Err title="Kompetenz-Cluster-Risiko" message={data.error} />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4 text-primary" /> Kompetenz-Cluster-Risiko
          <Badge variant="secondary" className="ml-auto text-[10px]">{data.rows.length} Cluster</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Outcome-Daten im Zeitraum.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.rows.map((r) => (
              <li key={r.outcome_type} className="rounded-lg border bg-card p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{OUTCOME_TYPE_SHORT[r.outcome_type] ?? r.outcome_type}</span>
                  <BandPill band={r.band}>{r.low_share_pct}% kritisch</BandPill>
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  Ø Score {r.avg_score} · {r.sample_size} Outcomes · {r.learners} Azubis
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CrossOrgReadinessCard({ orgId, days }: { orgId: string | null; days: number }) {
  const { data, isLoading } = useCrossOrgReadiness(orgId, days);
  if (isLoading || !data) return <Skel title="Cross-Org Readiness" />;
  if (isErr(data)) return <Err title="Cross-Org Readiness" message={data.error} />;

  const section = (title: string, items: Array<{ id: string; name: string; learners: number; avg_score: number; band: Band }>) => (
    <div>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {items.map((i) => (
            <div key={i.id} className="flex items-center justify-between rounded border bg-card px-2 py-1.5 text-xs">
              <div className="truncate">
                <div className="font-medium">{i.name}</div>
                <div className="text-[10px] text-muted-foreground">{i.learners} Azubis</div>
              </div>
              <BandPill band={i.band}>{i.avg_score}</BandPill>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-primary" /> Cross-Org Readiness
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {section("Standorte", data.sites.map((s) => ({ id: s.site_id, name: s.name, learners: s.learners, avg_score: s.avg_score, band: s.band })))}
        {section("Departments", data.departments.map((d) => ({ id: d.department_id, name: d.name, learners: d.learners, avg_score: d.avg_score, band: d.band })))}
        {section("Cohorts", data.cohorts.map((c) => ({ id: c.cohort_id, name: c.name, learners: c.learners, avg_score: c.avg_score, band: c.band })))}
      </CardContent>
    </Card>
  );
}

function ExecutiveNarrativeCard({ orgId, days }: { orgId: string | null; days: number }) {
  const { data, isLoading } = useExecutiveNarrative(orgId, days);
  if (isLoading || !data) return <Skel title="Executive Narrative" />;
  if (data.reason !== "OK") return null;
  if (!data.bullets?.length) return null;
  return (
    <Card className="border-primary/30 bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="h-4 w-4 text-primary" /> Executive Narrative
          <Badge variant="outline" className="ml-auto text-[10px]">{data.bullets.length} Bullets</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5 text-sm">
          {data.bullets.map((b, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>{b.text}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
