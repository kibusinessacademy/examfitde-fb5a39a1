import { Helmet } from "react-helmet-async";
import { Link, useParams, Navigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { BerufOSHeader } from "@/components/berufos/BerufOSHeader";
import { BerufOSFooter } from "@/components/berufos/BerufOSFooter";
import { ProductLandingShell } from "@/components/products/ProductLandingShell";
import { PRODUCTS, PRODUCT_SLUGS, getProduct } from "@/lib/products/product-registry";
import { BERUFOS } from "@/lib/berufos/brand";
import { ArrowRight } from "lucide-react";

import "@/components/berufos/berufos-theme.css";

/**
 * /produkte — Hub aller Premium-Produktseiten.
 */
export function ProduktHub() {
  const canonical = `${BERUFOS.domain}/produkte`;
  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "BerufOS Produkte",
    url: canonical,
    description:
      "Premium-KI-Module für Unternehmen, HR, Bildungsträger und Selbstständige — kontrolliert, auditierbar, DSGVO- & EU-AI-Act-konform.",
    hasPart: PRODUCT_SLUGS.map((slug) => ({
      "@type": "Product",
      name: PRODUCTS[slug].name,
      url: `${BERUFOS.domain}/produkte/${slug}`,
    })),
  };

  return (
    <div className="berufos min-h-screen bg-background">
      <Helmet>
        <title>BerufOS Produkte — Premium-KI-Module für Unternehmen</title>
        <meta
          name="description"
          content="VertragscheckerOS · IdeenlosOS · ComplianceOS · BerufOS-Plattform. Kontrollierte, auditierbare KI-Operations. DSGVO- & EU-AI-Act-ready."
        />
        <link rel="canonical" href={canonical} />
        <meta property="og:title" content="BerufOS Produkte — Premium-KI-Module" />
        <meta property="og:url" content={canonical} />
        <meta property="og:type" content="website" />
        <script type="application/ld+json">{JSON.stringify(collectionLd)}</script>
      </Helmet>

      <BerufOSHeader />

      <section className="max-w-7xl mx-auto px-6 pt-16 pb-12">
        <div className="text-xs berufos-text-dim uppercase tracking-wider mb-3">
          Produkte
        </div>
        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-tight mb-6 max-w-3xl">
          AI-native Module, die Arbeit erledigen — nicht nur Texte erzeugen.
        </h1>
        <p className="text-lg berufos-text-dim max-w-2xl">
          Jedes Produkt ist ein eigenständiger Layer auf BerufOS. Auditierbar, governance-fähig, mit Human-in-the-loop dort, wo es zählt.
        </p>
      </section>

      <section className="max-w-7xl mx-auto px-6 pb-24">
        <div className="grid gap-6 md:grid-cols-2">
          {PRODUCT_SLUGS.map((slug) => {
            const p = PRODUCTS[slug];
            return (
              <Link
                key={slug}
                to={`/produkte/${slug}`}
                className="group block focus:outline-none"
              >
                <Card className="h-full border-border bg-card/40 hover:bg-card transition-colors">
                  <CardContent className="p-8">
                    <div className="text-xs berufos-text-dim uppercase tracking-wider mb-3">
                      {p.category}
                    </div>
                    <div className="text-2xl font-semibold mb-3 group-hover:text-[hsl(var(--bos-accent))] transition-colors">
                      {p.name}
                    </div>
                    <p className="text-sm berufos-text-dim leading-relaxed mb-6">
                      {p.hero.subline}
                    </p>
                    <div className="text-sm font-medium inline-flex items-center gap-2 text-[hsl(var(--bos-accent))]">
                      Mehr erfahren <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      <BerufOSFooter />
    </div>
  );
}

/**
 * /produkte/:slug — dynamische Route. Unbekannte Slugs → /produkte.
 */
export default function ProductLandingPage() {
  const { slug } = useParams<{ slug: string }>();
  const product = slug ? getProduct(slug) : undefined;
  if (!product) {
    return <Navigate to="/produkte" replace />;
  }
  return <ProductLandingShell product={product} />;
}
