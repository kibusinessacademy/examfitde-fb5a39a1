/**
 * Public Suites Hub — Marketing-Einstiegspunkt für die 4 Berufs-KI Suiten.
 * Route: /suites
 *
 * Plan: Berufs-KI Market Activation v1 — Cut 1 (Packaging & Positionierung).
 */
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ArrowRight, Layers, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PublicHubLayout } from "@/components/berufos/PublicHubLayout";
import { SUITE_CONTENT, type SuiteContent } from "@/lib/suites/content";

const SUITES: SuiteContent[] = Object.values(SUITE_CONTENT);

  return (
    <PublicHubLayout>
    <div className="min-h-screen bg-surface-base">
      <Helmet>
        <title>Berufs-KI Suiten — Rollenbasierte Pakete für Ausbildung & Workforce</title>
        <meta
          name="description"
          content="Vier kuratierte Suiten für Ausbildungsleiter, Azubis, Recovery-Coaching und Multi-Standort. Klare Outcomes, transparente Preise, sofort startbereit."
        />
        <link rel="canonical" href="https://berufos.com/suites" />
      </Helmet>

      <header className="border-b border-border-subtle bg-surface-raised">
        <div className="container mx-auto max-w-6xl px-4 py-12 md:py-16">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
            <Sparkles className="h-3.5 w-3.5" />
            Berufs-KI · Produkt-Suiten
          </div>
          <h1 className="mt-2 text-3xl font-semibold leading-tight text-text-primary md:text-4xl">
            Rollenbasierte Pakete statt Feature-Listen
          </h1>
          <p className="mt-3 max-w-2xl text-base text-text-secondary">
            Vier Suiten — jede bündelt die Cockpits, Automationen und Graph-Aktivierungen für eine
            konkrete Rolle. Klarer Nutzen, transparente Preise, sofort startbereit.
          </p>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-10">
        <div className="grid gap-5 md:grid-cols-2">
          {SUITES.map((s) => (
            <Card
              key={s.slug}
              className="group border-border-subtle bg-surface-raised transition hover:border-border-strong hover:shadow-elev-2"
            >
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-text-secondary" />
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                    {s.hero.eyebrow}
                  </Badge>
                </div>
                <CardTitle className="mt-2 text-xl text-text-primary">{s.hero.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-text-secondary">{s.hero.subtitle}</p>

                <ul className="space-y-1.5 text-xs text-text-secondary">
                  {s.outcomes.slice(0, 3).map((o) => (
                    <li key={o.title} className="flex items-start gap-2">
                      <span className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-text-secondary/60" />
                      <span><strong className="text-text-primary">{o.title}.</strong> {o.body}</span>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {s.roi.map((m) => (
                    <Badge key={m.label} variant="secondary" className="text-[10px]">
                      {m.label}: <span className="ml-1 font-semibold">{m.value}</span>
                    </Badge>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  <Button asChild size="sm">
                    <Link to={`/suites/${s.slug}`}>
                      Details ansehen <ArrowRight className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link to={s.hero.primaryCta.href}>{s.hero.primaryCta.label}</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <section className="mt-12 rounded-lg border border-border-subtle bg-surface-raised p-6 md:p-8">
          <h2 className="text-lg font-semibold text-text-primary">Nicht sicher, welche Suite passt?</h2>
          <p className="mt-2 max-w-2xl text-sm text-text-secondary">
            In 15 Minuten klären wir gemeinsam Ihre Rolle, Ihr Setup und Ihre Outcomes. Kein Sales-Pitch —
            ein strukturiertes Gespräch.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/enterprise-demo">Live-Demo ansehen</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/kontakt">Beratung anfragen</Link>
            </Button>
          </div>
        </section>
      </main>
    </div>
    </PublicHubLayout>
  );
}
