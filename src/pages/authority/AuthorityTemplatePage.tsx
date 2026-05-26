import { Helmet } from "react-helmet-async";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { findTemplate } from "@/lib/authority/templates";
import { findTopic } from "@/lib/authority/catalog";
import { TemplateViewer } from "@/components/authority/TemplateViewer";
import NotFound from "@/pages/NotFound";

export default function AuthorityTemplatePage() {
  const { slug } = useParams<{ slug: string }>();
  const doc = slug ? findTemplate(slug) : undefined;
  const topic = doc ? findTopic(doc.topicSlug) : undefined;
  if (!doc || !topic) return <NotFound />;

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>{doc.title} · BerufOS Authority</title>
        <meta name="description" content={doc.metaDescription} />
        <link rel="canonical" href={`https://berufos.com/authority/vorlage/${doc.slug}`} />
      </Helmet>

      <section className="mx-auto max-w-3xl px-6 pt-10 pb-6">
        <Link
          to={`/authority/${topic.slug}`}
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {topic.title}
        </Link>
        <Badge variant="outline" className="mt-3">{doc.source}</Badge>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">{doc.title}</h1>
        <p className="mt-3 text-muted-foreground leading-relaxed">{doc.intro}</p>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-12">
        <TemplateViewer doc={doc} />
        <p className="mt-4 text-xs text-muted-foreground">
          Diese Vorlage ist ein Mustertext. Vor produktivem Einsatz anwaltliche Prüfung empfohlen.
        </p>
      </section>
    </main>
  );
}
