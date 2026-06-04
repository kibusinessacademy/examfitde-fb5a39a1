import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";

interface BreadcrumbItem {
  href: string | null;
  label: string;
}
interface SiblingLink {
  href: string;
  label: string;
  sort_order?: number;
}
interface IntentSections {
  h1?: string;
  intro?: string;
  pain_points?: string;
  expert_tip?: string;
  breadcrumbs?: BreadcrumbItem[];
  internal_links?: {
    hub?: { href: string; label: string };
    quiz?: { href: string; label: string };
    tutor?: { href: string; label: string };
    trainer?: { href: string; label: string };
    siblings?: SiblingLink[];
  };
  cta?: {
    primary?: { href: string; label: string };
    secondary?: { href: string; label: string };
  };
}
interface FaqItem {
  q: string;
  a?: string;
  a_seed?: string;
}
interface IntentPage {
  id: string;
  slug: string;
  title: string;
  meta_description: string | null;
  sections_json: IntentSections;
  faq_json: FaqItem[] | null;
  quality_score: number;
  last_generated_at: string | null;
  intent_template: string;
  persona_type: string;
}

const SITE_URL = "https://berufos.com";

export default function IntentLandingPage() {
  const { curriculumSlug, intentSlug, competencySlug } = useParams<{
    curriculumSlug: string;
    intentSlug: string;
    competencySlug: string;
  }>();
  const [page, setPage] = useState<IntentPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!curriculumSlug || !intentSlug || !competencySlug) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("get_published_intent_page", {
        p_curriculum_slug: curriculumSlug,
        p_intent_slug: intentSlug,
        p_competency_slug: competencySlug,
      });
      if (cancelled) return;
      if (error || !data) {
        setNotFound(true);
      } else {
        setPage(data as unknown as IntentPage);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [curriculumSlug, intentSlug, competencySlug]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (notFound || !page) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-2xl text-center">
        <Helmet>
          <title>Seite nicht gefunden — berufos.com</title>
          <meta name="robots" content="noindex" />
        </Helmet>
        <h1 className="text-3xl font-semibold text-foreground mb-4">
          Diese Lernseite existiert noch nicht
        </h1>
        <p className="text-muted-foreground mb-8">
          Wir haben für diese Kombination aus Kurs, Intent und Kompetenz noch
          keinen veröffentlichten Inhalt.
        </p>
        <Button asChild>
          <Link to="/themen">Zur Themen-Übersicht</Link>
        </Button>
      </div>
    );
  }

  const s = page.sections_json || {};
  const breadcrumbs = s.breadcrumbs || [];
  const links = s.internal_links || {};
  const cta = s.cta || {};
  const faqs = (page.faq_json || []).filter((f) => f && f.q);
  const canonical = `${SITE_URL}/kurse/${page.slug}`;

  // JSON-LD: Article + BreadcrumbList + FAQPage (only if FAQs)
  const jsonLd: object[] = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: page.title,
      description: page.meta_description ?? undefined,
      author: { "@type": "Organization", name: "berufos.com" },
      publisher: { "@type": "Organization", name: "berufos.com" },
      datePublished: page.last_generated_at ?? undefined,
      dateModified: page.last_generated_at ?? undefined,
      mainEntityOfPage: canonical,
    },
  ];
  if (breadcrumbs.length > 0) {
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbs.map((b, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: b.label,
        item: b.href ? `${SITE_URL}${b.href}` : canonical,
      })),
    });
  }
  if (faqs.length > 0) {
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: {
          "@type": "Answer",
          text: f.a || f.a_seed || "",
        },
      })),
    });
  }

  return (
    <article className="container mx-auto px-4 py-8 max-w-3xl">
      <Helmet>
        <title>{page.title}</title>
        {page.meta_description && (
          <meta name="description" content={page.meta_description} />
        )}
        <link rel="canonical" href={canonical} />
        <meta property="og:title" content={page.title} />
        {page.meta_description && (
          <meta property="og:description" content={page.meta_description} />
        )}
        <meta property="og:url" content={canonical} />
        <meta property="og:type" content="article" />
        {jsonLd.map((j, i) => (
          <script key={i} type="application/ld+json">
            {JSON.stringify(j)}
          </script>
        ))}
      </Helmet>

      {/* Breadcrumbs */}
      {breadcrumbs.length > 0 && (
        <nav
          aria-label="Breadcrumb"
          className="text-sm text-muted-foreground mb-6"
        >
          <ol className="flex flex-wrap gap-1">
            {breadcrumbs.map((b, i) => (
              <li key={i} className="flex items-center gap-1">
                {i > 0 && <span aria-hidden="true">/</span>}
                {b.href ? (
                  <Link to={b.href} className="hover:text-foreground underline">
                    {b.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="text-foreground">
                    {b.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      {/* H1 */}
      <h1 className="text-3xl md:text-4xl font-semibold text-foreground mb-6">
        {s.h1 || page.title}
      </h1>

      {/* Intro */}
      {s.intro && (
        <section className="prose prose-neutral dark:prose-invert max-w-none mb-8">
          <p className="text-base leading-relaxed text-foreground whitespace-pre-line">
            {s.intro}
          </p>
        </section>
      )}

      {/* Pain Points */}
      {s.pain_points && (
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-3">
            Worauf Prüflinge hier oft stolpern
          </h2>
          <p className="text-base leading-relaxed text-foreground whitespace-pre-line">
            {s.pain_points}
          </p>
        </section>
      )}

      {/* Expert Tip */}
      {s.expert_tip && (
        <section className="mb-8 rounded-lg border border-border bg-muted/40 p-6">
          <h2 className="text-xl font-semibold text-foreground mb-3">
            Experten-Tipp
          </h2>
          <p className="text-base leading-relaxed text-foreground whitespace-pre-line">
            {s.expert_tip}
          </p>
        </section>
      )}

      {/* CTA */}
      {(cta.primary || cta.secondary) && (
        <div className="flex flex-wrap gap-3 mb-10">
          {cta.primary && (
            <Button asChild size="lg">
              <Link to={cta.primary.href}>{cta.primary.label}</Link>
            </Button>
          )}
          {cta.secondary && (
            <Button asChild variant="outline" size="lg">
              <Link to={cta.secondary.href}>{cta.secondary.label}</Link>
            </Button>
          )}
        </div>
      )}

      {/* FAQ */}
      {faqs.length > 0 && (
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            Häufige Fragen
          </h2>
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((f, i) => (
              <AccordionItem key={i} value={`faq-${i}`}>
                <AccordionTrigger className="text-left">{f.q}</AccordionTrigger>
                <AccordionContent>
                  <p className="whitespace-pre-line text-foreground">
                    {f.a || f.a_seed || ""}
                  </p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      )}

      {/* Internal Links */}
      <aside className="border-t border-border pt-8 mb-6">
        <h2 className="text-xl font-semibold text-foreground mb-4">
          Weiter im Kurs
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {links.hub && (
            <li>
              <Link
                to={links.hub.href}
                className="text-primary hover:underline"
              >
                {links.hub.label}
              </Link>
            </li>
          )}
          {links.trainer && (
            <li>
              <Link
                to={links.trainer.href}
                className="text-primary hover:underline"
              >
                {links.trainer.label}
              </Link>
            </li>
          )}
          {links.tutor && (
            <li>
              <Link
                to={links.tutor.href}
                className="text-primary hover:underline"
              >
                {links.tutor.label}
              </Link>
            </li>
          )}
          {links.quiz && (
            <li>
              <Link
                to={links.quiz.href}
                className="text-primary hover:underline"
              >
                {links.quiz.label}
              </Link>
            </li>
          )}
        </ul>
        {links.siblings && links.siblings.length > 0 && (
          <div className="mt-6">
            <h3 className="text-base font-medium text-foreground mb-2">
              Verwandte Kompetenzen
            </h3>
            <ul className="space-y-1">
              {links.siblings
                .slice()
                .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                .map((sib, i) => (
                  <li key={i}>
                    <Link
                      to={sib.href}
                      className="text-primary hover:underline"
                    >
                      {sib.label}
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </aside>
    </article>
  );
}
