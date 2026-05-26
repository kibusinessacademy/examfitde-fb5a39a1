import { Helmet } from "react-helmet-async";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { findTopic, AUTHORITY_TOPICS } from "@/lib/authority/catalog";
import { AssetCard } from "@/components/authority/AssetCard";
import NotFound from "@/pages/NotFound";

export default function AuthorityTopicPage() {
  const { topic: slug } = useParams<{ topic: string }>();
  const topic = slug ? findTopic(slug) : undefined;
  if (!topic) return <NotFound />;

  const related = topic.related
    .map((s) => AUTHORITY_TOPICS.find((t) => t.slug === s))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: topic.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>{topic.metaTitle}</title>
        <meta name="description" content={topic.metaDescription} />
        <link rel="canonical" href={`https://berufos.com/authority/${topic.slug}`} />
        <meta property="og:title" content={topic.metaTitle} />
        <meta property="og:description" content={topic.metaDescription} />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      <section className="mx-auto max-w-5xl px-6 pt-10 pb-6">
        <Link to="/authority" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Authority Hub
        </Link>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="capitalize">{topic.cluster}</Badge>
          {topic.audience.map((a) => (
            <Badge key={a} variant="secondary">{a}</Badge>
          ))}
        </div>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">{topic.title}</h1>
        <p className="mt-3 max-w-3xl text-lg text-muted-foreground leading-relaxed">{topic.intro}</p>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-10">
        <h2 className="text-xl font-semibold mb-4">Assets in diesem Hub</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {topic.assets.map((a) => (
            <AssetCard key={a.slug} asset={a} />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-10 border-t">
        <h2 className="text-xl font-semibold mb-4">Häufige Fragen</h2>
        <div className="space-y-3">
          {topic.faq.map((f, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <div className="font-medium">{f.q}</div>
                <div className="text-sm text-muted-foreground mt-1 leading-relaxed">{f.a}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {related.length > 0 && (
        <section className="mx-auto max-w-5xl px-6 py-10 border-t">
          <h2 className="text-xl font-semibold mb-4">Verwandte Hubs</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {related.map((r) => (
              <Link key={r.slug} to={`/authority/${r.slug}`} className="group">
                <Card className="transition hover:border-primary/40">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <div className="font-medium">{r.title}</div>
                      <div className="text-xs text-muted-foreground">{r.assets.length} Assets</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-primary transition-transform group-hover:translate-x-0.5" />
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
