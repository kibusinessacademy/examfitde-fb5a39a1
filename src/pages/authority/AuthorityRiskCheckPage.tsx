import { Helmet } from "react-helmet-async";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { findRiskCheck } from "@/lib/authority/risk-checks";
import { findTopic } from "@/lib/authority/catalog";
import { RiskCheckRunner } from "@/components/authority/RiskCheckRunner";
import NotFound from "@/pages/NotFound";

export default function AuthorityRiskCheckPage() {
  const { slug } = useParams<{ slug: string }>();
  const check = slug ? findRiskCheck(slug) : undefined;
  const topic = check ? findTopic(check.topicSlug) : undefined;
  if (!check || !topic) return <NotFound />;

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>{check.title} · BerufOS Authority</title>
        <meta name="description" content={check.metaDescription} />
        <link rel="canonical" href={`https://berufos.com/authority/risiko-check/${check.slug}`} />
      </Helmet>

      <section className="mx-auto max-w-3xl px-6 pt-10 pb-6">
        <Link
          to={`/authority/${topic.slug}`}
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {topic.title}
        </Link>
        <Badge variant="outline" className="mt-3">{check.source}</Badge>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">{check.title}</h1>
        <p className="mt-3 text-muted-foreground leading-relaxed">{check.intro}</p>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-12">
        <RiskCheckRunner check={check} />
      </section>
    </main>
  );
}
