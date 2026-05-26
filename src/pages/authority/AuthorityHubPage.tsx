import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, Bot, CheckCircle2, FileText, ShieldAlert, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AUTHORITY_TOPICS, allAssetsByKind } from "@/lib/authority/catalog";
import { AssetCard } from "@/components/authority/AssetCard";

const KIND_SECTIONS = [
  { kind: "tool" as const, label: "Interaktive Tools", Icon: Wrench },
  { kind: "risk-check" as const, label: "Risiko-Checks", Icon: ShieldAlert },
  { kind: "checklist" as const, label: "Checklisten", Icon: CheckCircle2 },
  { kind: "template" as const, label: "Vorlagen", Icon: FileText },
  { kind: "ai-assistant" as const, label: "KI-Assistenten", Icon: Bot },
];

export default function AuthorityHubPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "BerufOS Authority Hub",
    description: "Premium Content Authority Engine — Tools, Checklisten, Vorlagen, Risiko-Checks und KI-Assistenten für Personaler, Ausbildungsleiter und Unternehmer.",
    url: "https://berufos.com/authority",
    hasPart: AUTHORITY_TOPICS.map((t) => ({
      "@type": "WebPage",
      name: t.title,
      url: `https://berufos.com/authority/${t.slug}`,
    })),
  };

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>Authority Hub — Tools, Vorlagen & Risiko-Checks für HR | BerufOS</title>
        <meta
          name="description"
          content="Rechtssichere HR-Operations: Tools, Checklisten, Vorlagen, Risiko-Checks und KI-Assistenten für Kündigung, Ausbildung, Arbeitszeit, DSGVO und Verträge."
        />
        <link rel="canonical" href="https://berufos.com/authority" />
        <meta property="og:title" content="BerufOS Authority Hub" />
        <meta property="og:description" content="Premium Content Authority Engine für HR-Operations." />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      <section className="mx-auto max-w-6xl px-6 pt-12 pb-8">
        <Badge variant="secondary">Authority Hub</Badge>
        <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">
          Content Authority Engine für HR & Ausbildung.
        </h1>
        <p className="mt-4 max-w-3xl text-lg text-muted-foreground leading-relaxed">
          Sofort einsetzbare Tools, Checklisten, Vorlagen, Risiko-Checks und KI-Assistenten — kuratiert für
          Personaler, Ausbildungsleiter und Geschäftsführer. Jede Antwort mit Rechtsgrundlage.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-10">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" /> Themen-Hubs
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {AUTHORITY_TOPICS.map((t) => (
            <Link key={t.slug} to={`/authority/${t.slug}`} className="group block">
              <Card className="h-full transition-all hover:border-primary/40 hover:shadow-md">
                <CardContent className="p-5 space-y-2">
                  <Badge variant="outline" className="text-xs capitalize">{t.cluster}</Badge>
                  <h3 className="text-lg font-semibold">{t.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{t.intro}</p>
                  <div className="text-xs text-muted-foreground">
                    {t.assets.length} Assets · {t.audience.join(" · ")}
                  </div>
                  <div className="text-sm text-primary font-medium flex items-center gap-1 pt-1">
                    Hub öffnen <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {KIND_SECTIONS.map(({ kind, label, Icon }) => {
        const items = allAssetsByKind(kind);
        if (items.length === 0) return null;
        return (
          <section key={kind} className="mx-auto max-w-6xl px-6 py-10 border-t">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Icon className="h-5 w-5 text-primary" /> {label}
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {items.map(({ topic, asset }) => (
                <AssetCard key={`${topic.slug}-${asset.slug}`} asset={asset} />
              ))}
            </div>
          </section>
        );
      })}

      <section className="mx-auto max-w-6xl px-6 py-12 border-t">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold">Authority skaliert dein Recruiting & Ausbildungsoperations.</h2>
              <p className="mt-1 text-muted-foreground">
                Verknüpfe Tools und Checklisten mit BerufOS-Workflows, Auto-Empfehlungen und KI-Assistenten.
              </p>
            </div>
            <Link to="/suites" className="text-primary font-medium flex items-center gap-1">
              Produkt-Suiten ansehen <ArrowRight className="h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
