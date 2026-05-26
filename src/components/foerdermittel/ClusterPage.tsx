import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { ArrowLeft, Sparkles, Radar, FileCheck2, MessageSquare, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProgramCard } from "@/components/foerdermittel/ProgramCard";
import { FoerderRadarCard } from "@/components/foerdermittel/FoerderRadarCard";
import { EuAiActTransparencyCard } from "@/components/foerdermittel/EuAiActTransparencyCard";
import { FundingReportCta } from "@/components/foerdermittel/FundingReportCta";
import { JsonLdHead } from "@/components/seo/JsonLdHead";
import { buildBreadcrumbList, composeSchemaGraph } from "@/lib/seo/schema";
import {
  buildClusterMeta,
  buildSeoFaqs,
  recommendInternalLinks,
  type Cluster,
} from "@/lib/foerdermittel/seoAuthority";
import { scoreMatch } from "@/lib/foerdermittel/matching";
import { PROGRAMS } from "@/lib/foerdermittel/registry";
import type { LeadSourcePage } from "@/lib/foerdermittel/conversion";

const KIND_TO_SOURCE: Record<Cluster["meta"]["kind"], LeadSourcePage> = {
  state: "cluster_state",
  topic: "cluster_topic",
  industry: "cluster_industry",
  size: "hub",
  combination: "cluster_combination",
  aktuell: "cluster_current",
  antrag: "checklist",
};

export interface ClusterPageProps {
  cluster: Cluster;
  breadcrumbLabel: string;
  /** Optional override; default derived from cluster.meta.kind */
  leadSource?: LeadSourcePage;
}

export function ClusterPage({ cluster, breadcrumbLabel }: ClusterPageProps) {
  const head = buildClusterMeta(cluster);
  const faqs = buildSeoFaqs(cluster);
  const links = recommendInternalLinks(cluster, PROGRAMS);

  const matches = cluster.programs
    .map((p) => scoreMatch({ region: "DE", size: "small", topics: p.topics }, p))
    .sort((a, b) => b.fit - a.fit);

  const breadcrumb = buildBreadcrumbList([
    { name: "FördermittelOS", url: "https://berufos.com/foerdermittel" },
    { name: breadcrumbLabel, url: head.canonicalUrl },
  ]);
  const schema = composeSchemaGraph([breadcrumb]);

  /* Empty / thin state — high-quality no-index page */
  if (cluster.isThin || cluster.programs.length === 0) {
    return (
      <main className="min-h-screen bg-background">
        <Helmet>
          <title>{head.title}</title>
          <meta name="description" content={head.description} />
          <meta name="robots" content="noindex,follow" />
          <link rel="canonical" href={head.canonicalUrl} />
        </Helmet>
        <section className="mx-auto max-w-3xl px-6 py-20 text-center">
          <Badge variant="outline" className="mb-3">Cluster im Aufbau</Badge>
          <h1 className="text-3xl font-semibold tracking-tight">{cluster.meta.h1}</h1>
          <p className="mt-3 text-muted-foreground">
            Aktuell sind zu diesem Cluster keine geprüften Programme im Index — wir verzichten
            bewusst auf Platzhalter-Inhalte. Sobald passende Förderprogramme dokumentiert sind,
            wird die Seite freigegeben.
          </p>
          <div className="mt-6 flex gap-3 justify-center">
            <Button asChild>
              <Link to="/foerdermittel">Zum FördermittelOS-Hub</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/foerdermittel/aktuell">Aktuelle Programme</Link>
            </Button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <JsonLdHead
        schema={schema}
        canonical={head.canonicalUrl}
        title={head.title}
        description={head.description}
      />
      <Helmet>
        <meta name="robots" content={head.robots} />
        <meta name="keywords" content={cluster.meta.keywords.join(", ")} />
      </Helmet>

      <section className="mx-auto max-w-7xl px-6 pt-8 pb-2">
        <Link to="/foerdermittel" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> FördermittelOS-Hub
        </Link>
      </section>

      {/* Hero */}
      <section className="mx-auto max-w-7xl px-6 pt-2 pb-6">
        <Badge variant="outline" className="mb-2">{breadcrumbLabel}</Badge>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">{cluster.meta.h1}</h1>
        <p className="mt-3 text-lg text-muted-foreground max-w-3xl">{cluster.meta.lead}</p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>Authority-Score: <strong className="text-foreground">{cluster.authorityScore}</strong>/100</span>
          <span>·</span>
          <span>{cluster.programs.length} Programm(e) im Cluster</span>
        </div>
      </section>

      {/* Why relevant */}
      <section className="mx-auto max-w-7xl px-6 pb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Warum dieser Cluster relevant ist</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            <p>{cluster.meta.description}</p>
            <p>
              Authority-Score berücksichtigt Programmanzahl, Aktualität, Förderstellen-Diversität
              und thematische Breite — keine SEO-Phrasen, keine erfundenen Volumina.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* FörderRadar Freshness Strip */}
      <section className="mx-auto max-w-7xl px-6 pb-6">
        <FoerderRadarCard programs={cluster.programs} />
      </section>

      {/* Programs */}
      <section className="mx-auto max-w-7xl px-6 pb-8">
        <h2 className="text-2xl font-semibold tracking-tight mb-3 flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" /> Passende Förderprogramme
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {matches.map((m) => (<ProgramCard key={m.program.id} match={m} />))}
        </div>
      </section>

      {/* CTA Block */}
      <section className="mx-auto max-w-7xl px-6 pb-8 grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <Sparkles className="h-5 w-5 text-primary mb-2" />
            <div className="font-semibold">Matching starten</div>
            <p className="text-sm text-muted-foreground mt-1">Eigenes Profil eingeben — Fit, Bewilligungs­wahrscheinlichkeit, Risiken.</p>
            <Button asChild variant="outline" size="sm" className="mt-3"><Link to="/foerdermittel#matching">Matching-Wizard öffnen</Link></Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <FileCheck2 className="h-5 w-5 text-primary mb-2" />
            <div className="font-semibold">Antrag vorbereiten</div>
            <p className="text-sm text-muted-foreground mt-1">Readiness-Score, Dokumentencheck und 8-Phasen-Timeline pro Programm.</p>
            <Button asChild variant="outline" size="sm" className="mt-3"><Link to="/foerdermittel/antrag/checkliste">Checkliste öffnen</Link></Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <MessageSquare className="h-5 w-5 text-primary mb-2" />
            <div className="font-semibold">CoPilot fragen</div>
            <p className="text-sm text-muted-foreground mt-1">Grounded auf Registry, Freshness und Roadmap — keine offene Chat-Fläche.</p>
            <Button asChild variant="outline" size="sm" className="mt-3"><Link to={`/foerdermittel/programm/${cluster.programs[0]?.slug ?? ''}`}>CoPilot zu Top-Programm</Link></Button>
          </CardContent>
        </Card>
      </section>

      {/* Internal links */}
      <section className="mx-auto max-w-7xl px-6 pb-8">
        <h2 className="text-xl font-semibold tracking-tight mb-3">Weiterführend</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {links.map((l) => (
            <Link key={l.href} to={l.href} className="rounded-lg border p-3 hover:bg-muted transition block">
              <div className="font-medium text-sm">{l.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{l.reason}</div>
            </Link>
          ))}
        </div>
      </section>

      {/* FAQ (visible only, no JSON-LD to keep grounding contract clean) */}
      <section className="mx-auto max-w-7xl px-6 pb-10">
        <h2 className="text-xl font-semibold tracking-tight mb-3">Häufige Fragen</h2>
        <div className="space-y-3">
          {faqs.map((f, i) => (
            <Card key={i}><CardContent className="p-4">
              <div className="font-medium">{f.q}</div>
              <p className="text-sm text-muted-foreground mt-1">{f.a}</p>
            </CardContent></Card>
          ))}
        </div>
      </section>

      {/* EU AI Act transparency */}
      <section className="mx-auto max-w-7xl px-6 pb-14">
        <EuAiActTransparencyCard />
      </section>

      <section className="border-t bg-muted/30">
        <div className="mx-auto max-w-7xl px-6 py-6 text-xs text-muted-foreground flex items-center gap-2">
          <Radar className="h-3.5 w-3.5" />
          Disclaimer: FördermittelOS ersetzt keine verbindliche Förderberatung. Stand & Konditionen jedes Programms vor Antragstellung bei der offiziellen Förderstelle prüfen.
        </div>
      </section>
    </main>
  );
}
