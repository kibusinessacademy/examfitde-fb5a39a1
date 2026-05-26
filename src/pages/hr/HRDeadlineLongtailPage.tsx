/**
 * /hr/:slug — Longtail Programmable SEO Pages.
 * Eigener H1, FAQ-JSON-LD, Pre-Filled-Rechner, interne Verlinkung.
 */
import { Helmet } from "react-helmet-async";
import { Link, useParams, Navigate } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KuendigungsfristCalculator } from "@/components/hr/KuendigungsfristCalculator";
import { getLongtailPage, LONGTAIL_PAGES } from "@/lib/hr/longtail";

export default function HRDeadlineLongtailPage() {
  const { slug } = useParams<{ slug: string }>();
  const page = slug ? getLongtailPage(slug) : undefined;
  if (!page) return <Navigate to="/hr/fristenrechner-kuendigung" replace />;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  const related = page.relatedSlugs
    .map((s) => LONGTAIL_PAGES.find((p) => p.slug === s))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>{page.title}</title>
        <meta name="description" content={page.metaDescription} />
        <link rel="canonical" href={`https://berufos.com/hr/${page.slug}`} />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      <section className="mx-auto max-w-5xl px-6 pt-10 pb-6">
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link to="/hr/fristenrechner-kuendigung"><ArrowLeft className="mr-2 h-4 w-4" /> Alle Fristenrechner</Link>
        </Button>
        <Badge variant="secondary">HR Deadline OS</Badge>
        <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">{page.h1}</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">{page.intro}</p>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-10">
        <KuendigungsfristCalculator
          presetRole={page.preset.role}
          presetContract={page.preset.contract}
          presetTenureMonths={page.preset.presetTenureMonths}
        />
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-12">
        <h2 className="text-xl font-semibold tracking-tight">Häufige Fragen</h2>
        <div className="mt-4 space-y-3">
          {page.faq.map((f) => (
            <Card key={f.q}>
              <CardContent className="p-4">
                <p className="font-medium">{f.q}</p>
                <p className="mt-1.5 text-sm text-muted-foreground">{f.a}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {related.length > 0 && (
        <section className="mx-auto max-w-5xl px-6 pb-16">
          <h2 className="text-xl font-semibold tracking-tight">Verwandte Fristen</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {related.map((r) => (
              <Link key={r.slug} to={`/hr/${r.slug}`} className="group">
                <Card className="transition-all hover:border-primary">
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <span className="font-medium text-sm">{r.h1}</span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
