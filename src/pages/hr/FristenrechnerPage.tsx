/**
 * /hr/fristenrechner-kuendigung — HR Deadline OS Hauptlandingpage.
 * SEO: Hero → Rechner ATF → Ergebnis-CTAs → Authority-Content → Longtail-Links.
 */
import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, CheckCircle2, Scale, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KuendigungsfristCalculator } from "@/components/hr/KuendigungsfristCalculator";
import { LONGTAIL_PAGES } from "@/lib/hr/longtail";

export default function FristenrechnerPage() {
  const [leadOpen, setLeadOpen] = useState(false);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      { "@type": "Question", name: "Wie lange ist die gesetzliche Kündigungsfrist?", acceptedAnswer: { "@type": "Answer", text: "Die Grundfrist nach §622 Abs. 1 BGB beträgt 4 Wochen zum 15. oder zum Monatsende. Für Arbeitgeber verlängert sie sich nach Betriebszugehörigkeit auf bis zu 7 Monate." } },
      { "@type": "Question", name: "Welche Kündigungsfrist gilt in der Probezeit?", acceptedAnswer: { "@type": "Answer", text: "Während der Probezeit (max. 6 Monate) gilt nach §622 Abs. 3 BGB eine Kündigungsfrist von 2 Wochen ohne Termin." } },
      { "@type": "Question", name: "Was passiert, wenn die Kündigung zu spät zugeht?", acceptedAnswer: { "@type": "Answer", text: "Die Kündigung wird nicht unwirksam, sondern wirkt zum nächsten möglichen Beendigungstermin." } },
    ],
  };

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>Kündigungsfrist berechnen — schnell & rechtssicher · BerufOS</title>
        <meta name="description" content="Kündigungsfristen nach §622 BGB, Probezeit, Betriebszugehörigkeit und Ausbildung — sofort berechnen. Mit Rechtsgrundlage, Warnhinweisen und Folge-CTAs." />
        <link rel="canonical" href="https://berufos.com/hr/fristenrechner-kuendigung" />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      <section className="mx-auto max-w-5xl px-6 pt-12 pb-6">
        <Badge variant="secondary">HR Deadline OS · §622 BGB</Badge>
        <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">
          Kündigungsfrist berechnen — schnell & rechtssicher.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
          Berechne Kündigungsfristen nach §622 BGB, Probezeit, Betriebszugehörigkeit und Ausbildung.
          Mit Rechtsgrundlage, Warnhinweisen und passenden Folgeaktionen.
        </p>
        <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
          <li className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> Aktuelle Rechtsgrundlagen</li>
          <li className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> Für Arbeitgeber & Arbeitnehmer</li>
          <li className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary" /> Keine Anmeldung nötig</li>
        </ul>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-10">
        <KuendigungsfristCalculator onLead={() => setLeadOpen(true)} />
        {leadOpen && (
          <div className="mt-4 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 p-4 text-sm">
            <strong>Lead-Funnel (Preview):</strong> PDF-Export & Dokumenten-Automation öffnen hier in der Vollversion das HR-Workflow-Modul (Reminder, Kündigungsschreiben, Betriebsrats-Anhörung, Aufhebungsvertrag).
            <Button asChild size="sm" variant="link" className="ml-2 p-0"><Link to="/suites">Suiten ansehen →</Link></Button>
          </div>
        )}
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-12">
        <h2 className="text-2xl font-semibold tracking-tight">Häufige Fälle — direkt richtig berechnen</h2>
        <p className="mt-1 text-sm text-muted-foreground">Jeder Fall öffnet den Rechner mit passendem Kontext.</p>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {LONGTAIL_PAGES.map((p) => (
            <Link key={p.slug} to={`/hr/${p.slug}`} className="group">
              <Card className="h-full transition-all hover:border-primary hover:shadow-md">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-sm leading-tight">{p.h1}</h3>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground line-clamp-3">{p.intro}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-16">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="p-5">
              <Scale className="h-5 w-5 text-primary" />
              <h3 className="mt-2 font-semibold">Rechtssicher</h3>
              <p className="mt-1 text-sm text-muted-foreground">SSOT-Regeln nach §622 BGB, §22 BBiG, §102 BetrVG, §4 KSchG, §626 BGB.</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <h3 className="mt-2 font-semibold">Warnungen inklusive</h3>
              <p className="mt-1 text-sm text-muted-foreground">Tarifvertrag, Sonderkündigungsschutz, Betriebsrat, Zugang.</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <BookOpen className="h-5 w-5 text-primary" />
              <h3 className="mt-2 font-semibold">Folge-Workflows</h3>
              <p className="mt-1 text-sm text-muted-foreground">Kündigungsschreiben, Anhörung Betriebsrat, Aufhebungsvertrag.</p>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
