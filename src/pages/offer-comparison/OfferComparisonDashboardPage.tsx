import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Briefcase, FileCheck, FileText, Sparkles, ShieldAlert, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SAMPLE_PROJECTS } from "@/lib/offer-comparison/sample-data";
import { scoreProject } from "@/lib/offer-comparison/scoring";
import { buildExecutiveSummary, calcReadiness } from "@/lib/offer-comparison/decision-readiness";
import { AIExecutiveSummary } from "@/components/offer-comparison/AIExecutiveSummary";
import { ScoreRing } from "@/components/offer-comparison/ScoreRing";

const eur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

export default function OfferComparisonDashboardPage() {
  const projects = SAMPLE_PROJECTS;
  const totals = projects.reduce(
    (acc, p) => {
      acc.volume += p.offers.reduce((s, o) => s + o.totalCostEur, 0);
      acc.criticals += p.risks.filter((r) => r.level === "critical").length;
      acc.highs += p.risks.filter((r) => r.level === "high").length;
      const scored = scoreProject(p);
      const best = scored.sort((a, b) => b.score.overall - a.score.overall)[0];
      const cheap = [...scored].sort((a, b) => a.offer.totalCostEur - b.offer.totalCostEur)[0];
      if (best && cheap) acc.savings += Math.max(0, best.offer.totalCostEur - cheap.offer.totalCostEur);
      return acc;
    },
    { volume: 0, criticals: 0, highs: 0, savings: 0 },
  );

  const featured = projects[0];
  const featuredSummary = buildExecutiveSummary(featured, featured.risks);

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>AngebotsvergleichOS — AI-gestützte Procurement-Entscheidungen | BerufOS</title>
        <meta
          name="description"
          content="Angebote, Verträge und Anbieter mit AI strukturiert vergleichen, Risiken erkennen und boardroom-ready Entscheidungsvorlagen erzeugen."
        />
        <link rel="canonical" href="https://berufos.com/offer-comparison" />
      </Helmet>

      <section className="mx-auto max-w-7xl px-6 pt-10 pb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Badge variant="secondary">AngebotsvergleichOS</Badge>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Procurement Intelligence Dashboard</h1>
            <p className="mt-2 text-muted-foreground max-w-2xl">
              Treffen Sie bessere Entscheidungen — schneller, transparenter und risikobewusster.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/offer-comparison/projekt/lms-auswahl-2026">Demo öffnen</Link>
            </Button>
            <Button>
              Neues Projekt <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-6 grid gap-4 md:grid-cols-4">
        {[
          { icon: Briefcase, label: "Aktive Projekte", value: projects.length },
          { icon: Wallet, label: "Gesamtvolumen", value: eur(totals.volume) },
          { icon: ShieldAlert, label: "Kritische Risiken", value: totals.criticals },
          { icon: Sparkles, label: "Einsparpotenzial", value: eur(totals.savings) },
        ].map((kpi, i) => (
          <Card key={i}>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
                <kpi.icon className="h-3.5 w-3.5" /> {kpi.label}
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums">{kpi.value}</div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-8">
        <AIExecutiveSummary summary={featuredSummary} />
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-12">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Vergleichsprojekte</h2>
          <Link to="/offer-comparison" className="text-sm text-primary inline-flex items-center gap-1">
            Alle <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {projects.map((p) => {
            const scored = scoreProject(p);
            const best = scored.sort((a, b) => b.score.overall - a.score.overall)[0];
            const readiness = calcReadiness(p, p.risks);
            return (
              <Link key={p.id} to={`/offer-comparison/projekt/${p.slug}`} className="group">
                <Card className="h-full transition-all hover:border-primary/40 hover:shadow-md">
                  <CardContent className="p-5 flex gap-4">
                    <ScoreRing value={best?.score.overall ?? 0} size={84} label="Top" />
                    <div className="flex-1 min-w-0">
                      <Badge variant="outline" className="capitalize text-[10px]">{p.category}</Badge>
                      <div className="mt-1 font-semibold truncate">{p.name}</div>
                      <div className="text-sm text-muted-foreground truncate">{p.goal}</div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <div className="text-muted-foreground">Anbieter</div>
                          <div className="font-semibold tabular-nums">{p.offers.length}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Risiken</div>
                          <div className="font-semibold tabular-nums">{p.risks.length}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Readiness</div>
                          <div className="font-semibold tabular-nums">{readiness.score}%</div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16 grid gap-3 md:grid-cols-3">
        {[
          { icon: FileText, title: "Dokument-Intelligenz", body: "Preise, SLAs, Klauseln und Risiken werden inline aus Verträgen extrahiert." },
          { icon: ShieldAlert, title: "Risk Engine", body: "Lock-in, Hidden Costs, Auto-Renewal, Datenschutz — sofort sichtbar mit Verhandlungs-Hebel." },
          { icon: FileCheck, title: "Boardroom-Briefing", body: "Executive Summary, Score-Ranking, Watchouts — als Briefing exportieren." },
        ].map((f, i) => (
          <Card key={i}>
            <CardContent className="p-5 space-y-2">
              <f.icon className="h-5 w-5 text-primary" />
              <div className="font-semibold">{f.title}</div>
              <div className="text-sm text-muted-foreground">{f.body}</div>
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
