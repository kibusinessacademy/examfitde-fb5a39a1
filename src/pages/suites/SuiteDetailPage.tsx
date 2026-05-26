/**
 * Public Suite Detail — Marketing-Detailseite pro Suite.
 * Route: /suites/:slug
 *
 * Plan: Berufs-KI Market Activation v1 — Cut 1 (Packaging & Positionierung).
 */
import { Link, useParams, Navigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ArrowRight, Check, ChevronRight, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSuiteContent } from "@/lib/suites/content";

export default function SuiteDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const suite = slug ? getSuiteContent(slug) : null;

  if (!suite) return <Navigate to="/suites" replace />;

  const canonical = `https://berufos.com/suites/${suite.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: suite.hero.title,
    description: suite.hero.subtitle,
    brand: { "@type": "Brand", name: "Berufs-KI" },
    offers: suite.pricing.map((p) => ({
      "@type": "Offer",
      name: p.name,
      priceCurrency: "EUR",
      description: p.priceHint,
    })),
  };

  return (
    <div className="min-h-screen bg-surface-base">
      <Helmet>
        <title>{suite.hero.eyebrow} — {suite.hero.title}</title>
        <meta name="description" content={suite.hero.subtitle} />
        <link rel="canonical" href={canonical} />
        <meta property="og:title" content={`${suite.hero.eyebrow} — Berufs-KI`} />
        <meta property="og:description" content={suite.hero.subtitle} />
        <meta property="og:url" content={canonical} />
        <meta property="og:type" content="website" />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      {/* Breadcrumb */}
      <nav className="border-b border-border-subtle bg-surface-raised">
        <div className="container mx-auto max-w-6xl px-4 py-3 text-xs text-text-secondary">
          <Link to="/suites" className="hover:text-text-primary">Suiten</Link>
          <ChevronRight className="mx-1 inline h-3 w-3" />
          <span className="text-text-primary">{suite.hero.eyebrow}</span>
        </div>
      </nav>

      {/* Hero */}
      <header className="border-b border-border-subtle bg-surface-raised">
        <div className="container mx-auto max-w-6xl px-4 py-10 md:py-14">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
            <Sparkles className="h-3.5 w-3.5" /> {suite.hero.eyebrow}
          </div>
          <h1 className="mt-2 text-3xl font-semibold text-text-primary md:text-4xl">
            {suite.hero.title}
          </h1>
          <p className="mt-3 max-w-2xl text-base text-text-secondary">{suite.hero.subtitle}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button asChild size="lg">
              <Link to={suite.hero.primaryCta.href}>
                {suite.hero.primaryCta.label} <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
            {suite.hero.secondaryCta && (
              <Button asChild size="lg" variant="outline">
                <Link to={suite.hero.secondaryCta.href}>{suite.hero.secondaryCta.label}</Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-10 space-y-12">
        {/* Outcomes */}
        <section>
          <h2 className="text-xl font-semibold text-text-primary">Was Sie davon haben</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {suite.outcomes.map((o) => (
              <Card key={o.title} className="border-border-subtle bg-surface-raised">
                <CardContent className="space-y-2 p-5">
                  <div className="text-sm font-semibold text-text-primary">{o.title}</div>
                  <p className="text-sm text-text-secondary">{o.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* ROI */}
        <section>
          <h2 className="text-xl font-semibold text-text-primary">Messbare Wirkung</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {suite.roi.map((m) => (
              <Card key={m.label} className="border-border-subtle bg-surface-raised">
                <CardContent className="p-5">
                  <div className="text-2xl font-semibold text-text-primary">{m.value}</div>
                  <div className="mt-1 text-sm font-medium text-text-primary">{m.label}</div>
                  <div className="mt-1 text-xs text-text-secondary">{m.hint}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Features */}
        <section>
          <h2 className="text-xl font-semibold text-text-primary">Was enthalten ist</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {suite.features.map((f) => (
              <div
                key={f.title}
                className="flex items-start gap-3 rounded-md border border-border-subtle bg-surface-raised p-4"
              >
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-text-primary" />
                <div>
                  <div className="text-sm font-semibold text-text-primary">{f.title}</div>
                  <p className="mt-1 text-sm text-text-secondary">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section>
          <h2 className="text-xl font-semibold text-text-primary">Pakete</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {suite.pricing.map((p) => (
              <Card
                key={p.name}
                className={
                  "border-border-subtle bg-surface-raised " +
                  (p.highlight ? "ring-1 ring-border-strong" : "")
                }
              >
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-lg font-semibold text-text-primary">{p.name}</div>
                      <div className="text-xs text-text-secondary">{p.audience}</div>
                    </div>
                    <Badge variant={p.highlight ? "default" : "secondary"} className="text-[10px]">
                      {p.priceHint}
                    </Badge>
                  </div>
                  <ul className="space-y-1.5 text-sm text-text-secondary">
                    {p.includes.map((it) => (
                      <li key={it} className="flex items-start gap-2">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-primary" />
                        <span>{it}</span>
                      </li>
                    ))}
                  </ul>
                  <Button asChild size="sm" variant={p.highlight ? "default" : "outline"} className="w-full">
                    <Link to={p.cta.href}>{p.cta.label}</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Proof */}
        {suite.proofPoints.length > 0 && (
          <section className="rounded-lg border border-border-subtle bg-surface-raised p-6">
            <h2 className="text-lg font-semibold text-text-primary">Warum es funktioniert</h2>
            <ul className="mt-3 space-y-2 text-sm text-text-secondary">
              {suite.proofPoints.map((p) => (
                <li key={p} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-text-primary" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* FAQs */}
        {suite.faqs.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold text-text-primary">Häufige Fragen</h2>
            <div className="mt-4 space-y-3">
              {suite.faqs.map((f) => (
                <Card key={f.q} className="border-border-subtle bg-surface-raised">
                  <CardContent className="space-y-1 p-4">
                    <div className="text-sm font-semibold text-text-primary">{f.q}</div>
                    <p className="text-sm text-text-secondary">{f.a}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Closing CTA */}
        <section className="rounded-lg border border-border-subtle bg-surface-raised p-6 md:p-8">
          <h2 className="text-lg font-semibold text-text-primary">Bereit für den nächsten Schritt?</h2>
          <p className="mt-2 max-w-2xl text-sm text-text-secondary">
            Sehen Sie die Suite live oder sprechen Sie mit unserem Team über Ihr Setup.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild>
              <Link to={suite.hero.primaryCta.href}>{suite.hero.primaryCta.label}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/enterprise-demo">Live-Demo ansehen</Link>
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
