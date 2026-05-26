/**
 * /demo/cohort/:slug — Sample-Cohort-Detailansicht mit View-Switch.
 * Views: risk | recovery | exam_risk | compare | intervention | narrative
 */
import { useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, AlertTriangle, TrendingUp, Activity, GitCompareArrows, Users, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { SAMPLE_COHORTS, getCohort, type RiskBand } from "@/lib/demo/cohorts";
import { buildCohortNarrative } from "@/lib/demo/narratives";

type View = "risk" | "recovery" | "exam_risk" | "compare" | "intervention" | "narrative";

const VIEW_LABEL: Record<View, string> = {
  risk: "Risiko-Sicht",
  recovery: "Recovery-Wirkung",
  exam_risk: "Prüfungs-Forecast",
  compare: "Kohorten-Vergleich",
  intervention: "Intervention",
  narrative: "AI-Narrative",
};

const VIEW_ICON: Record<View, typeof AlertTriangle> = {
  risk: AlertTriangle,
  recovery: TrendingUp,
  exam_risk: Activity,
  compare: GitCompareArrows,
  intervention: Users,
  narrative: Sparkles,
};

function bandColor(b: RiskBand): string {
  return b === "red"
    ? "bg-destructive/10 text-destructive border-destructive/30"
    : b === "amber"
    ? "bg-warning/10 text-warning-foreground border-warning/30"
    : "bg-success/10 text-success-foreground border-success/30";
}

export default function DemoCohortPage() {
  const { slug } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const view = (params.get("view") as View) || "risk";
  const cohort = slug ? getCohort(slug) : undefined;

  const narrative = useMemo(() => (cohort ? buildCohortNarrative(cohort) : null), [cohort]);
  const compareTarget = useMemo(
    () => SAMPLE_COHORTS.find((c) => c.slug !== slug) ?? SAMPLE_COHORTS[0],
    [slug],
  );

  if (!cohort) {
    return (
      <main className="min-h-screen bg-background p-6">
        <p className="text-muted-foreground">Kohorte nicht gefunden.</p>
        <Button asChild variant="link"><Link to="/demo">Zurück zur Demo</Link></Button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>{cohort.name} · Live-Demo · BerufsKI</title>
        <meta name="description" content={cohort.narrative.substring(0, 155)} />
      </Helmet>

      <section className="mx-auto max-w-6xl px-6 pt-10 pb-6">
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link to="/demo"><ArrowLeft className="mr-2 h-4 w-4" /> Alle Demos</Link>
        </Button>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{cohort.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {cohort.curriculum} · {cohort.examWindow} · {cohort.size} Teilnehmer
            </p>
          </div>
          <Badge variant="secondary">Demo-Cohort</Badge>
        </div>
        <p className="mt-4 max-w-3xl text-muted-foreground">{cohort.narrative}</p>

        <div className="mt-6 flex flex-wrap gap-2">
          {(Object.keys(VIEW_LABEL) as View[]).map((v) => {
            const Icon = VIEW_ICON[v];
            const isActive = v === view;
            return (
              <Button
                key={v}
                asChild
                size="sm"
                variant={isActive ? "default" : "outline"}
              >
                <Link to={`/demo/cohort/${cohort.slug}?view=${v}`}>
                  <Icon className="mr-1.5 h-3.5 w-3.5" /> {VIEW_LABEL[v]}
                </Link>
              </Button>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-12">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-8">
          {cohort.kpis.map((k) => (
            <Card key={k.label}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className="mt-1 text-2xl font-bold">{k.value}</p>
                {k.delta && (
                  <p
                    className={
                      "mt-1 text-xs " +
                      (k.tone === "positive"
                        ? "text-success-foreground"
                        : k.tone === "negative"
                        ? "text-destructive"
                        : "text-muted-foreground")
                    }
                  >
                    {k.delta}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {view === "risk" && (
          <Card>
            <CardHeader><CardTitle>Top-Risiko-Lernende</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {cohort.topRiskLearners.map((l) => (
                <div key={l.initials} className={"rounded-md border p-3 " + bandColor(l.band)}>
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{l.initials}</div>
                    <Badge variant="outline">Risiko {l.riskScore}</Badge>
                  </div>
                  <p className="mt-1 text-sm">Driver: {l.driver}</p>
                  <p className="mt-1 text-xs">Empfehlung: {l.recommendedIntervention}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {view === "recovery" && (
          <Card>
            <CardHeader><CardTitle>Recovery-Wirkung pro Kompetenz</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {cohort.competencyHotspots.map((h) => (
                <div key={h.competency}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{h.competency}</span>
                    <span className="text-muted-foreground">Lift +{h.recoveryLiftPct}%</span>
                  </div>
                  <Progress value={h.masteryPct} className="mt-2" />
                  <p className="mt-1 text-xs text-muted-foreground">Mastery {h.masteryPct}% · {h.note}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {view === "exam_risk" && (
          <Card>
            <CardHeader><CardTitle>Outcome-Forecast</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-3">
                <span className="text-5xl font-bold">{cohort.outcomeForecast.examPassProbability}%</span>
                <span className="text-sm text-muted-foreground">Prüfungswahrscheinlichkeit</span>
              </div>
              <Badge variant="secondary" className="mt-2">Konfidenz: {cohort.outcomeForecast.confidence}</Badge>
              <h4 className="mt-6 font-semibold text-sm">Forecast-Driver</h4>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {cohort.outcomeForecast.drivers.map((d) => <li key={d}>• {d}</li>)}
              </ul>
            </CardContent>
          </Card>
        )}

        {view === "compare" && (
          <div className="grid gap-4 md:grid-cols-2">
            {[cohort, compareTarget].map((c) => (
              <Card key={c.slug}>
                <CardHeader><CardTitle className="text-base">{c.name}</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Forecast</span><span className="font-semibold">{c.outcomeForecast.examPassProbability}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Rote Lernende</span><span className="font-semibold">{c.riskDistribution.red}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Letzter Recovery-Lift</span><span className="font-semibold">+{c.recentInterventions[0]?.effectPct ?? 0}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Top-Hotspot</span><span className="font-semibold">{c.competencyHotspots[0]?.competency}</span></div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {view === "intervention" && (
          <Card>
            <CardHeader><CardTitle>Letzte Interventionen & Wirkung</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {cohort.recentInterventions.map((i, idx) => (
                <div key={idx} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">{i.outcome}</p>
                    <p className="text-xs text-muted-foreground">{i.date} · {i.type}</p>
                  </div>
                  <Badge variant={i.effectPct >= 15 ? "default" : "outline"}>+{i.effectPct}%</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {view === "narrative" && narrative && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Executive Narrative</CardTitle></CardHeader>
            <CardContent>
              <p className="text-lg font-semibold">{narrative.headline}</p>
              <ul className="mt-4 space-y-2 text-sm">
                {narrative.bullets.map((b, i) => <li key={i}>• {b}</li>)}
              </ul>
              <div className="mt-6 rounded-md border bg-muted/30 p-3 text-sm">
                <span className="font-semibold">Empfehlung: </span>{narrative.recommendation}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Deterministisch aus Graph-Evidence — keine AI-Halluzination.
              </p>
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}
