/**
 * Berufs-KI Hub (`/berufs-ki`) — Marketing-Einstieg.
 * Eigenständige Produktlinie neben ExamFit. „Die KI kennt deinen Beruf."
 */
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BERUFS_KI, CATEGORY_DESCRIPTION, CATEGORY_LABEL } from "@/lib/berufs-ki/copy";
import type { WorkflowCategory } from "@/lib/berufs-ki/types";

const CATEGORIES: WorkflowCategory[] = [
  "kommunikation",
  "analyse",
  "dokumentation",
  "organisation",
  "fach",
  "lernhilfe",
];

export default function BerufsKIHubPage() {
  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>Berufs-KI · Die KI kennt deinen Beruf · ExamFit</title>
        <meta name="description" content={BERUFS_KI.brand.promise} />
        <link rel="canonical" href="https://berufos.com/berufs-ki" />
      </Helmet>

      <section className="mx-auto max-w-5xl px-6 pt-20 pb-12">
        <div className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" /> {BERUFS_KI.hub.eyebrow}
        </div>
        <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-5xl">{BERUFS_KI.hub.headline}</h1>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{BERUFS_KI.hub.subline}</p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/demo">
              Live-Demo erleben <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/suites">Produkt-Suiten</Link>
          </Button>
          <Button asChild variant="ghost" size="lg">
            <Link to="/berufs-ki/app">{BERUFS_KI.hub.cta_primary}</Link>
          </Button>
        </div>
      </section>

      <section id="kategorien" className="mx-auto max-w-5xl px-6 pb-20">
        <h2 className="text-2xl font-semibold tracking-tight">Was möchtest du erledigen?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Berufs-KI bringt dir vorgefertigte Profi-Workflows — kein leeres Chatfenster.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((cat) => (
            <Link key={cat} to={`/berufs-ki/app?category=${cat}`} className="group">
              <Card className="h-full transition-all hover:border-primary hover:shadow-md">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{CATEGORY_LABEL[cat]}</h3>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground">{CATEGORY_DESCRIPTION[cat]}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div className="mt-12 rounded-2xl border bg-muted/30 p-6">
          <h3 className="text-lg font-semibold">Warum Berufs-KI?</h3>
          <ul className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            <li>✓ Workflows statt Prompts — strukturierter Output</li>
            <li>✓ DSGVO-sicher, ohne Halluzinationen</li>
            <li>✓ Berufs- und Rollen-Kontext bleibt erhalten</li>
            <li>✓ Bridge zu ExamFit-Curricula, Lernfeldern und Kompetenzen</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
