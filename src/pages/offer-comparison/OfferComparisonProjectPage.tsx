import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useParams, Navigate } from "react-router-dom";
import { ArrowLeft, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { findProject } from "@/lib/offer-comparison/sample-data";
import { scoreProject, LABEL_META } from "@/lib/offer-comparison/scoring";
import { buildExecutiveSummary, calcReadiness } from "@/lib/offer-comparison/decision-readiness";
import { downloadBriefing } from "@/lib/offer-comparison/export";
import { AIExecutiveSummary } from "@/components/offer-comparison/AIExecutiveSummary";
import { ScoreRing } from "@/components/offer-comparison/ScoreRing";
import { ScoreRadar } from "@/components/offer-comparison/ScoreRadar";
import { RiskHeatmap } from "@/components/offer-comparison/RiskHeatmap";
import { ComparisonMatrix } from "@/components/offer-comparison/ComparisonMatrix";
import { RiskList } from "@/components/offer-comparison/RiskList";
import { NegotiationPanel } from "@/components/offer-comparison/NegotiationPanel";
import { DecisionReadinessCard } from "@/components/offer-comparison/DecisionReadinessCard";

const eur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

export default function OfferComparisonProjectPage() {
  const { slug } = useParams<{ slug: string }>();
  const project = slug ? findProject(slug) : undefined;
  const [tab, setTab] = useState("overview");

  const scored = useMemo(() => (project ? scoreProject(project) : []), [project]);
  const sorted = useMemo(() => [...scored].sort((a, b) => b.score.overall - a.score.overall), [scored]);
  const summary = useMemo(() => (project ? buildExecutiveSummary(project, project.risks) : null), [project]);
  const readiness = useMemo(() => (project ? calcReadiness(project, project.risks) : null), [project]);

  if (!project || !summary || !readiness) return <Navigate to="/offer-comparison" replace />;

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>{project.name} · AngebotsvergleichOS</title>
        <meta name="description" content={project.goal} />
        <link rel="canonical" href={`https://berufos.com/offer-comparison/projekt/${project.slug}`} />
      </Helmet>

      <section className="mx-auto max-w-7xl px-6 pt-8 pb-4">
        <Link to="/offer-comparison" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
        </Link>
        <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Badge variant="outline" className="capitalize">{project.category}</Badge>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{project.name}</h1>
            <p className="mt-1 text-muted-foreground max-w-2xl">{project.goal}</p>
            <div className="mt-2 text-sm text-muted-foreground">
              Budget {eur(project.budgetEur)} · {project.offers.length} Anbieter · Owner {project.owner}
            </div>
          </div>
          <Button variant="outline" onClick={() => downloadBriefing(project, project.risks)}>
            <Download className="h-4 w-4 mr-1.5" /> Executive Briefing
          </Button>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-6">
        <AIExecutiveSummary summary={summary} />
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-12">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="comparison">Anbietervergleich</TabsTrigger>
            <TabsTrigger value="risks">Risiken</TabsTrigger>
            <TabsTrigger value="negotiation">Verhandlung</TabsTrigger>
            <TabsTrigger value="decision">Entscheidung</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-6 space-y-6">
            <div className="grid gap-4 lg:grid-cols-3">
              {sorted.map((s) => (
                <Card key={s.offer.id} className="overflow-hidden">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs text-muted-foreground uppercase tracking-wider">{s.offer.vendor}</div>
                        <div className="font-semibold">{s.offer.productName}</div>
                      </div>
                      <ScoreRing value={s.score.overall} size={72} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {s.score.labels.map((l) => (
                        <Badge key={l} variant="outline" className="text-[10px]">{LABEL_META[l].label}</Badge>
                      ))}
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <div className="text-muted-foreground">TCO</div>
                        <div className="font-semibold tabular-nums">{eur(s.offer.totalCostEur)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Laufzeit</div>
                        <div className="font-semibold tabular-nums">{s.offer.termMonths} Mon.</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Kündigung</div>
                        <div className="font-semibold tabular-nums">{s.offer.noticePeriodDays} T.</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardContent className="p-5">
                  <div className="text-sm font-semibold mb-2">Score-Profile</div>
                  <ScoreRadar scored={scored} />
                </CardContent>
              </Card>
              <DecisionReadinessCard readiness={readiness} />
            </div>
            <RiskHeatmap project={project} risks={project.risks} />
          </TabsContent>

          <TabsContent value="comparison" className="mt-6">
            <ComparisonMatrix project={project} scored={scored} />
          </TabsContent>

          <TabsContent value="risks" className="mt-6 space-y-4">
            <RiskHeatmap project={project} risks={project.risks} />
            <RiskList project={project} risks={project.risks} />
          </TabsContent>

          <TabsContent value="negotiation" className="mt-6">
            <NegotiationPanel project={project} risks={project.risks} scored={scored} />
          </TabsContent>

          <TabsContent value="decision" className="mt-6 grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardContent className="p-5">
                  <div className="text-sm font-semibold mb-3">AI-Empfehlung</div>
                  {summary.recommendation && (
                    <div className="space-y-2">
                      <Badge>{summary.recommendation.label}</Badge>
                      <p className="text-sm text-muted-foreground">{summary.recommendation.rationale}</p>
                    </div>
                  )}
                  <div className="mt-4 text-xs text-muted-foreground border-t pt-3">
                    Disclaimer: AI-Ausgaben sind Entscheidungsunterstützung und ersetzen keine anwaltliche oder steuerliche Beratung.
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <div className="text-sm font-semibold mb-3">Entscheidungshistorie</div>
                  {project.decisionLog.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Noch keine Einträge.</div>
                  ) : (
                    <ul className="space-y-2 text-sm">
                      {project.decisionLog.map((d) => (
                        <li key={d.id} className="border-l-2 border-primary/40 pl-3">
                          <div className="text-xs text-muted-foreground">
                            {new Date(d.at).toLocaleString("de-DE")} · {d.actor}
                          </div>
                          <div>{d.text}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
            <DecisionReadinessCard readiness={readiness} />
          </TabsContent>
        </Tabs>
      </section>
    </main>
  );
}
