import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles, Radar, ShieldCheck, Layers, Bell } from "lucide-react";
import { MatchingWizard } from "@/components/foerdermittel/MatchingWizard";
import { ProgramCard } from "@/components/foerdermittel/ProgramCard";
import { matchPrograms, rankNoise } from "@/lib/foerdermittel/matching";
import { PROGRAMS } from "@/lib/foerdermittel/registry";
import type { CompanyProfile, ProgramMatch } from "@/lib/foerdermittel/types";

export default function FoerdermittelHubPage() {
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const matches = useMemo<ProgramMatch[]>(() => (profile ? matchPrograms(profile) : []), [profile]);
  const grouped = useMemo(() => rankNoise(matches), [matches]);

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>FördermittelOS · Fördermittel-Intelligence für KMU & Mittelstand</title>
        <meta
          name="description"
          content="Intelligente Fördermittel-Plattform: Programme finden, Bewilligungs­wahrscheinlichkeit prüfen, Fristen tracken, Anträge vorbereiten. Bund, Länder, EU."
        />
        <link rel="canonical" href="https://berufos.com/foerdermittel" />
      </Helmet>

      {/* Hero */}
      <section className="border-b">
        <div className="mx-auto max-w-7xl px-6 py-14">
          <Badge variant="outline" className="mb-3">FördermittelOS</Badge>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight max-w-3xl">
            Den Fördermittel-Dschungel operationalisieren.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl">
            Über 1.500 Programme aus Bund, Ländern und EU — laufend aktualisiert, intelligent
            gematcht, mit Bewilligungs­wahrscheinlichkeit und Fristen-Tracking.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <span className="text-xs text-muted-foreground">
              {PROGRAMS.length} Programme im Live-Index (Cut 1) · Bund + 3 Länder + EU bereits angebunden
            </span>
          </div>
        </div>
      </section>

      {/* Wizard */}
      <section className="mx-auto max-w-7xl px-6 py-10">
        <h2 className="text-2xl font-semibold tracking-tight mb-1">Matching-Wizard</h2>
        <p className="text-muted-foreground mb-5">
          Unternehmensprofil eingeben — wir errechnen Fit, Bewilligungs­wahrscheinlichkeit und
          Risiken in unter einer Sekunde.
        </p>
        <MatchingWizard initial={profile ?? undefined} onSubmit={setProfile} />
      </section>

      {/* Results */}
      {profile && (
        <section className="mx-auto max-w-7xl px-6 pb-14 space-y-8">
          {grouped.excellent.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-4 w-4 text-emerald-600" />
                <h3 className="text-lg font-semibold">Top-Matches ({grouped.excellent.length})</h3>
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {grouped.excellent.map((m) => (<ProgramCard key={m.program.id} match={m} />))}
              </div>
            </div>
          )}
          {grouped.good.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <h3 className="text-lg font-semibold">Solide Optionen ({grouped.good.length})</h3>
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {grouped.good.map((m) => (<ProgramCard key={m.program.id} match={m} />))}
              </div>
            </div>
          )}
          {grouped.watch.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Radar className="h-4 w-4 text-amber-500" />
                <h3 className="text-lg font-semibold">Beobachten ({grouped.watch.length})</h3>
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {grouped.watch.map((m) => (<ProgramCard key={m.program.id} match={m} />))}
              </div>
            </div>
          )}
          {matches.length === 0 && (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                Keine Programme matchen das aktuelle Profil. Bitte Ziele oder Region anpassen.
              </CardContent>
            </Card>
          )}
        </section>
      )}

      {/* Architecture pillars */}
      <section className="border-t bg-muted/30">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <h2 className="text-2xl font-semibold tracking-tight">Fördermittel-Intelligence in 5 Layern</h2>
          <p className="text-muted-foreground mt-1 mb-6 max-w-2xl">
            Kein Verzeichnis — ein lebendes System aus Knowledge Graph, Ingestion-Pipeline,
            Change-Detection, Matching-Engine und CoPilot.
          </p>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {[
              { icon: Layers, t: "Registry OS", d: "Strukturierte Förder-Entitäten (SSOT)." },
              { icon: Sparkles, t: "Intelligence Engine", d: "AI-Normalisierung, Klassifikation, Change Detection." },
              { icon: ShieldCheck, t: "Matching Engine", d: "Unternehmens-Fit & Bewilligungs­wahrscheinlichkeit." },
              { icon: Bell, t: "Execution OS", d: "Fristen, Dokumente, Auszahlungsschritte." },
              { icon: Radar, t: "AI CoPilot", d: "Empfehlungen, Antragsentwürfe, Risiko-Checks." },
            ].map((p) => (
              <Card key={p.t}>
                <CardContent className="p-4">
                  <p.icon className="h-4 w-4 text-primary mb-2" />
                  <div className="font-semibold text-sm">{p.t}</div>
                  <div className="text-xs text-muted-foreground mt-1">{p.d}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* SEO topic clusters */}
      <section className="mx-auto max-w-7xl px-6 py-12">
        <h2 className="text-2xl font-semibold tracking-tight mb-4">Themen-Cluster</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { slug: "digitalisierung", label: "Digitalisierung & KI" },
            { slug: "weiterbildung", label: "Weiterbildung & Personal" },
            { slug: "energie", label: "Energie & Nachhaltigkeit" },
            { slug: "gruendung", label: "Gründung & Innovation" },
          ].map((c) => (
            <Link
              key={c.slug}
              to={`/foerdermittel/thema/${c.slug}`}
              className="rounded-lg border p-4 hover:bg-muted transition"
            >
              <div className="font-semibold">{c.label}</div>
              <div className="text-xs text-muted-foreground mt-1">Programme & Leitfäden</div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
