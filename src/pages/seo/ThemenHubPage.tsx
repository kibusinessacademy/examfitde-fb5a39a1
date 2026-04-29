import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { ArrowRight, BookOpen, Award, Mic, Target, Layers, Briefcase } from "lucide-react";
import { SITE_URL } from "@/lib/seo";

/**
 * Topic-Map Hub: zentrale Übersicht aller Pillar-Cluster.
 * Zweck: interne Linkdichte, thematische Abdeckung, Crawler-Discovery.
 * Verlinkt von Footer + Sitemap.
 */

interface PillarCluster {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  hub: { label: string; to: string };
  spokes: Array<{ label: string; to: string }>;
}

const CLUSTERS: PillarCluster[] = [
  {
    id: "ihk",
    icon: Award,
    title: "IHK-Prüfungsvorbereitung",
    description:
      "Alles rund um die IHK-Abschlussprüfung — schriftlich, mündlich, Probeprüfungen und Original-Prüfungsfragen.",
    hub: { label: "IHK-Prüfungsvorbereitung Übersicht", to: "/ihk-pruefungsvorbereitung" },
    spokes: [
      { label: "IHK-Prüfungsfragen", to: "/ihk-pruefungsfragen" },
      { label: "IHK-Fachgespräch", to: "/ihk-fachgespraech" },
      { label: "IHK-Probeprüfung", to: "/ihk-probepruefung" },
      { label: "Alle IHK-Prüfungen", to: "/ihk-pruefungen" },
    ],
  },
  {
    id: "aevo",
    icon: BookOpen,
    title: "AEVO / Ausbildereignung",
    description:
      "Vollständiger Pillar-Cluster für die Ausbildereignungsprüfung — Theorie, Praxis und Fachgespräch.",
    hub: { label: "AEVO-Prüfungsvorbereitung", to: "/aevo-pruefungsvorbereitung" },
    spokes: [
      { label: "AEVO schriftliche Prüfung", to: "/aevo-schriftliche-pruefung" },
      { label: "AEVO praktische Prüfung", to: "/aevo-praktische-pruefung" },
      { label: "AEVO Fachgespräch", to: "/aevo-fachgespraech" },
      { label: "Pruefungsreife testen", to: "/quiz/aevo-pruefungsreife" },
    ],
  },
  {
    id: "muendlich",
    icon: Mic,
    title: "Mündliche Prüfung",
    description:
      "KI-Coach, Fachgespräch-Simulationen und Methoden für die mündliche Prüfungsphase — Ausbildung, Fachwirt, Studium.",
    hub: { label: "Mündliche Prüfung Übersicht", to: "/muendliche-pruefung" },
    spokes: [
      { label: "Mündliche Prüfung Studium", to: "/muendliche-pruefung-studium" },
      { label: "IHK-Fachgespräch", to: "/ihk-fachgespraech" },
      { label: "AEVO Fachgespräch", to: "/aevo-fachgespraech" },
      { label: "Probeprüfung", to: "/probepruefung" },
    ],
  },
  {
    id: "lernen",
    icon: Target,
    title: "Lernmethoden & Prüfungswissen",
    description:
      "Lernpläne, Prüfungsangst-Methodik, Bestehens-Rechner und didaktisch fundierte Prüfungsstrategien.",
    hub: { label: "Lernplan zur Prüfung", to: "/lernplan-pruefung" },
    spokes: [
      { label: "Bestehens-Rechner", to: "/bestehensrechner" },
      { label: "Häufige Prüfungsfehler", to: "/pruefungsfehler" },
      { label: "Frage des Tages", to: "/frage-des-tages" },
      { label: "Wissens-Datenbank", to: "/wissen" },
    ],
  },
  {
    id: "berufe",
    icon: Briefcase,
    title: "Berufe & Cluster nach Beruf",
    description:
      "Tiefgehende Pillar-Cluster für die wichtigsten IHK-Berufe — Bilanzbuchhalter, Fachinformatiker, Wirtschaftsfachwirt u. v. m.",
    hub: { label: "Alle Berufe", to: "/berufe" },
    spokes: [
      { label: "Bilanzbuchhalter Vorbereitung", to: "/bilanzbuchhalter-pruefungsvorbereitung" },
      { label: "Fachinformatiker AE", to: "/fachinformatiker-ae-pruefungsvorbereitung" },
      { label: "Wirtschaftsfachwirt", to: "/pruefungstraining/fachwirt/wirtschaftsfachwirt" },
      { label: "Alle Ausbildungsberufe", to: "/ausbildung" },
    ],
  },
  {
    id: "studium",
    icon: Layers,
    title: "Studium & Hochschule",
    description:
      "Prüfungsvorbereitung für Klausuren, BWL, Rechnungswesen und mündliche Hochschulprüfungen.",
    hub: { label: "Studium Prüfungsvorbereitung", to: "/studium-pruefungsvorbereitung" },
    spokes: [
      { label: "Klausurtraining Studium", to: "/klausurtraining-studium" },
      { label: "BWL Klausur", to: "/bwl-klausur" },
      { label: "Rechnungswesen Studium", to: "/rechnungswesen-studium" },
      { label: "Lernplan Studium", to: "/lernplan-studium" },
    ],
  },
];

export default function ThemenHubPage() {
  const canonical = `${SITE_URL}/themen`;

  // CollectionPage + ItemList Schema für LLM-Discovery
  const schema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Themen-Übersicht — Prüfungsvorbereitung mit ExamFit",
    description:
      "Zentrale Topic-Map für IHK-Prüfungen, AEVO, mündliche Prüfungen, Lernmethoden und alle Berufs-Cluster.",
    url: canonical,
    inLanguage: "de-DE",
    isPartOf: {
      "@type": "WebSite",
      name: "ExamFit",
      url: SITE_URL,
    },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: CLUSTERS.map((c, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: c.title,
        url: `${SITE_URL}${c.hub.to}`,
        description: c.description,
      })),
    },
  };

  return (
    <>
      <Helmet>
        <title>Themen-Übersicht: IHK, AEVO, Mündliche Prüfung & mehr | ExamFit</title>
        <meta
          name="description"
          content="Alle Pillar-Cluster auf einen Blick: IHK-Prüfungsvorbereitung, AEVO, mündliche Prüfungen, Lernmethoden, Berufe und Studium — die komplette Topic-Map von ExamFit."
        />
        <link rel="canonical" href={canonical} />
        <meta property="og:title" content="Themen-Übersicht — ExamFit Prüfungsvorbereitung" />
        <meta property="og:description" content="Topic-Map: IHK, AEVO, mündliche Prüfungen, Berufe, Lernmethoden." />
        <meta property="og:url" content={canonical} />
        <script type="application/ld+json">{JSON.stringify(schema)}</script>
      </Helmet>

      <div className="container max-w-6xl py-10">
        <Breadcrumbs items={[{ label: "Themen-Übersicht" }]} className="mb-6" />

        <header className="mb-10 max-w-3xl">
          <h1 className="text-4xl md:text-5xl font-display font-bold mb-4">
            Themen-Übersicht
          </h1>
          <p className="text-lg text-muted-foreground">
            Die komplette Topic-Map zu Prüfungsvorbereitung, Lernmethoden und Berufs-Clustern.
            Wähle einen Themenbereich und tauche tiefer ein.
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          {CLUSTERS.map((cluster) => {
            const Icon = cluster.icon;
            return (
              <Card key={cluster.id} className="h-full flex flex-col">
                <CardHeader>
                  <div className="flex items-start gap-3 mb-2">
                    <div className="rounded-lg p-2 bg-primary/10 text-primary">
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-xl">{cluster.title}</CardTitle>
                    </div>
                  </div>
                  <CardDescription className="text-sm leading-relaxed">
                    {cluster.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col">
                  <Link
                    to={cluster.hub.to}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline mb-4"
                  >
                    {cluster.hub.label} <ArrowRight className="h-4 w-4" />
                  </Link>
                  <div className="flex flex-wrap gap-2 mt-auto">
                    {cluster.spokes.map((spoke) => (
                      <Link key={spoke.to} to={spoke.to}>
                        <Badge variant="secondary" className="hover:bg-secondary/80 transition-colors">
                          {spoke.label}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <section className="mt-12 p-6 rounded-xl bg-muted/40 border border-border">
          <h2 className="text-xl font-semibold mb-3">Weitere Einstiegspunkte</h2>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Prüfungstraining-Hub", to: "/pruefungstraining" },
              { label: "Alle Ausbildungsberufe", to: "/ausbildung" },
              { label: "Fachwirt-Prüfungen", to: "/fachwirt" },
              { label: "Meister-Prüfungen", to: "/meister" },
              { label: "Sachkunde-Prüfungen", to: "/sachkunde" },
              { label: "Projektmanagement", to: "/projektmanagement" },
              { label: "Blog & Wissen", to: "/blog" },
              { label: "FAQ", to: "/faq" },
            ].map((l) => (
              <Link key={l.to} to={l.to}>
                <Badge variant="outline" className="hover:bg-muted transition-colors">
                  {l.label}
                </Badge>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
