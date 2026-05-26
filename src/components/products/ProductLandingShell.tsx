import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Check, Shield, FileCheck, Sparkles, Lock } from "lucide-react";
import { BerufOSHeader } from "@/components/berufos/BerufOSHeader";
import { BerufOSFooter } from "@/components/berufos/BerufOSFooter";
import { PersonaCTA } from "@/components/products/PersonaCTA";
import { TRUST_PILLARS, type ProductDef } from "@/lib/products/product-registry";
import { BERUFOS } from "@/lib/berufos/brand";

import "@/components/berufos/berufos-theme.css";

interface ProductLandingShellProps {
  product: ProductDef;
}

/**
 * Premium ProductLandingShell — wird von /produkte/:slug pro Produkt gerendert.
 * Layout: Hero → USP-Grid → Trust-Pillars → FAQ-Accordion (semantisch + JSON-LD) → Final-CTA.
 * Persona-aware CTA via ?persona=<key>.
 */
export function ProductLandingShell({ product }: ProductLandingShellProps) {
  const canonical = `${BERUFOS.domain}/produkte/${product.slug}`;
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Start", item: BERUFOS.domain + "/" },
      { "@type": "ListItem", position: 2, name: "Produkte", item: BERUFOS.domain + "/produkte" },
      { "@type": "ListItem", position: 3, name: product.name, item: canonical },
    ],
  };
  const productLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    category: product.category,
    description: product.meta.description,
    brand: { "@type": "Brand", name: BERUFOS.name },
    url: canonical,
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: product.faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };

  return (
    <div className="berufos min-h-screen bg-background">
      <Helmet>
        <title>{product.meta.title}</title>
        <meta name="description" content={product.meta.description} />
        <meta property="og:title" content={product.meta.title} />
        <meta property="og:description" content={product.meta.description} />
        <meta property="og:url" content={canonical} />
        <meta property="og:type" content="website" />
        <link rel="canonical" href={canonical} />
        <script type="application/ld+json">{JSON.stringify(productLd)}</script>
        <script type="application/ld+json">{JSON.stringify(breadcrumbLd)}</script>
        <script type="application/ld+json">{JSON.stringify(faqLd)}</script>
      </Helmet>

      <BerufOSHeader />

      {/* Breadcrumb */}
      <div className="max-w-7xl mx-auto px-6 pt-8 text-xs berufos-text-dim">
        <Link to="/" className="hover:text-foreground">Start</Link>
        <span className="mx-2">›</span>
        <Link to="/produkte" className="hover:text-foreground">Produkte</Link>
        <span className="mx-2">›</span>
        <span className="text-foreground">{product.name}</span>
      </div>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-6 pt-12 pb-20">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs berufos-text-dim border berufos-hairline mb-6">
            <Sparkles className="h-3 w-3" />
            {product.hero.eyebrow}
          </div>
          <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.1] mb-6">
            {product.hero.headline}
          </h1>
          <p className="text-lg md:text-xl berufos-text-dim leading-relaxed mb-10">
            {product.hero.subline}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <PersonaCTA cta={product.cta} />
            <Link to="/produkte" className="text-sm berufos-text-dim hover:text-foreground">
              Alle Produkte ansehen →
            </Link>
          </div>
          {product.transparencyNote ? (
            <p className="mt-8 text-xs berufos-text-faint max-w-2xl border-l-2 border-border pl-4">
              <Shield className="inline h-3 w-3 mr-1" />
              {product.transparencyNote}
            </p>
          ) : null}
        </div>
      </section>

      {/* USPs */}
      <section className="max-w-7xl mx-auto px-6 py-20 border-t berufos-hairline">
        <div className="mb-12">
          <div className="text-xs berufos-text-dim uppercase tracking-wider mb-3">
            Premium USPs
          </div>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
            Was {product.name} ausmacht
          </h2>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {product.usps.map((usp) => (
            <Card key={usp.title} className="border-border bg-card/40">
              <CardContent className="p-6">
                <div className="flex items-start gap-3">
                  <div className="h-8 w-8 rounded-md bg-[hsl(var(--bos-accent))/0.12] flex items-center justify-center shrink-0">
                    <Check className="h-4 w-4 text-[hsl(var(--bos-accent))]" />
                  </div>
                  <div>
                    <div className="font-medium mb-1">{usp.title}</div>
                    <p className="text-sm berufos-text-dim leading-relaxed">{usp.body}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Trust Pillars */}
      <section className="max-w-7xl mx-auto px-6 py-20 border-t berufos-hairline">
        <div className="mb-12">
          <div className="text-xs berufos-text-dim uppercase tracking-wider mb-3 flex items-center gap-2">
            <Lock className="h-3 w-3" />
            Vertrauensanker
          </div>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight max-w-2xl">
            Governance-first. DSGVO- & EU-AI-Act-ready.
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {TRUST_PILLARS.map((p) => (
            <div
              key={p.title}
              className="rounded-lg border berufos-hairline p-5 bg-card/30"
            >
              <div className="flex items-center gap-2 mb-2">
                <FileCheck className="h-4 w-4 text-[hsl(var(--bos-accent))]" />
                <div className="font-medium text-sm">{p.title}</div>
              </div>
              <p className="text-xs berufos-text-dim leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-4xl mx-auto px-6 py-20 border-t berufos-hairline">
        <div className="mb-10">
          <div className="text-xs berufos-text-dim uppercase tracking-wider mb-3">
            Häufige Fragen
          </div>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
            Was Sie noch wissen sollten
          </h2>
        </div>
        <div className="space-y-3">
          {product.faqs.map((f, i) => (
            <details
              key={i}
              className="group rounded-lg border berufos-hairline bg-card/30 p-5 open:bg-card/60 transition-colors"
            >
              <summary className="font-medium cursor-pointer list-none flex items-start justify-between gap-4">
                <span>{f.question}</span>
                <span className="berufos-text-dim text-xl leading-none mt-[-2px] group-open:rotate-45 transition-transform">
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm berufos-text-dim leading-relaxed">{f.answer}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-7xl mx-auto px-6 py-24 border-t berufos-hairline">
        <div className="rounded-2xl border berufos-hairline bg-gradient-to-br from-[hsl(var(--bos-accent))/0.06] to-transparent p-10 md:p-14 text-center">
          <h2 className="text-3xl md:text-5xl font-semibold tracking-tight mb-4 max-w-2xl mx-auto">
            Bereit, {product.name} live zu erleben?
          </h2>
          <p className="berufos-text-dim max-w-xl mx-auto mb-8">
            Kontrollierte, auditierbare, governance-fähige KI-Operations — DSGVO- & EU-AI-Act-ready.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <PersonaCTA cta={product.cta} />
            <Link to="/demo" className="text-sm berufos-text-dim hover:text-foreground">
              Oder Live-Beratung buchen →
            </Link>
          </div>
        </div>
      </section>

      <BerufOSFooter />
    </div>
  );
}
