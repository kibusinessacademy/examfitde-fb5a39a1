/**
 * /demo — Demo-Hub. „Erlebe BerufsKI in 60–120 Sekunden."
 */
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { ArrowRight, Clock, Play, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SAMPLE_COHORTS } from "@/lib/demo/cohorts";
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios";
import { GUIDED_TOURS } from "@/lib/demo/tours";

export default function DemoHubPage() {
  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>Live-Demo · BerufsKI in 60 Sekunden erleben</title>
        <meta
          name="description"
          content="Erlebe BerufsKI in 60–120 Sekunden: Sample-Kohorten, One-Click-Szenarien, Persona-Tours. Sofort sichtbare Workforce-Intelligence."
        />
        <link rel="canonical" href="/demo" />
      </Helmet>

      <section className="mx-auto max-w-6xl px-6 pt-16 pb-10">
        <Badge variant="secondary" className="mb-4">Live-Demo · Keine Anmeldung</Badge>
        <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
          Erlebe BerufsKI in 60 Sekunden.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
          Echte Kohorten. Echte Risiken. Echte Recovery-Wirkung. Klicke ein Szenario — und sieh,
          warum BerufsKI mehr ist als ein AI-Tool.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/demo/journey">
              Activation Journey starten <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/suites">Produkt-Suiten</Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-12">
        <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Play className="h-5 w-5" /> One-Click-Szenarien
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">Klicke eines an — sofort sichtbare Intelligence.</p>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DEMO_SCENARIOS.map((s) => {
            const Icon = s.icon;
            return (
              <Link
                key={s.id}
                to={`/demo/cohort/${s.cohortSlug}?view=${s.view}`}
                className="group"
              >
                <Card className="h-full transition-all hover:border-primary hover:shadow-md">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="rounded-md bg-muted p-2">
                        <Icon className="h-4 w-4 text-foreground" />
                      </div>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" /> ~{s.estimatedSeconds}s
                      </span>
                    </div>
                    <h3 className="mt-3 font-semibold">{s.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
                    <div className="mt-3 text-xs text-primary group-hover:underline">
                      Szenario starten →
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-12">
        <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Compass className="h-5 w-5" /> Persona-Tours
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">Sieh BerufsKI aus deiner Rolle.</p>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {GUIDED_TOURS.map((t) => (
            <Card key={t.persona}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t.label}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-muted-foreground">{t.promise}</p>
                <div className="mt-3 text-xs text-muted-foreground">
                  {t.steps.length} Schritte · ~{t.durationSeconds}s
                </div>
                <Button asChild variant="outline" size="sm" className="mt-4 w-full">
                  <Link to={t.steps[0].ctaHref}>Tour starten</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <h2 className="text-2xl font-semibold tracking-tight">Sample-Kohorten</h2>
        <p className="mt-2 text-sm text-muted-foreground">Realistische Daten — keine leeren Dashboards.</p>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {SAMPLE_COHORTS.map((c) => (
            <Link key={c.slug} to={`/demo/cohort/${c.slug}`} className="group">
              <Card className="h-full transition-all hover:border-primary hover:shadow-md">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{c.name}</h3>
                    <Badge variant="outline">{c.size} TN</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{c.curriculum} · {c.examWindow}</p>
                  <p className="mt-3 text-sm">{c.headlineRisk}</p>
                  <div className="mt-3 flex gap-3 text-xs text-muted-foreground">
                    <span>🔴 {c.riskDistribution.red}</span>
                    <span>🟠 {c.riskDistribution.amber}</span>
                    <span>🟢 {c.riskDistribution.green}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
