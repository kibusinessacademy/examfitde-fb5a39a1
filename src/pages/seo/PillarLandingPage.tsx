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

const SITE_URL = "https://berufos.com";

interface BreadcrumbItem {
  href: string | null;
  label: string;
}
interface SpokeLink {
  href: string;
  label: string;
  intent?: string;
}
interface PillarSections {
  h1?: string;
  intro?: string;
  curriculum_overview?: string;
  learning_journey?: string;
  exam_strategy?: string;
  breadcrumbs?: BreadcrumbItem[];
  internal_links?: SpokeLink[];
  cta?: { href: string; label: string };
}
interface FaqItem {
  q: string;
  a?: string;
  a_seed?: string;
}
interface PillarPage {
  id: string;
  slug: string;
  title: string;
  meta_description: string | null;
  sections_json: PillarSections;
  faq_json: FaqItem[] | null;
  quality_score: number;
  last_generated_at: string | null;
  curriculum_title?: string;
  curriculum_slug?: string;
}

export default function PillarLandingPage() {
  const { curriculumSlug } = useParams<{ curriculumSlug: string }>();
  const [page, setPage] = useState<PillarPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!curriculumSlug) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("get_published_pillar_page", {
        p_curriculum_slug: curriculumSlug,
      });
      if (cancelled) return;
      if (error || !data) {
        setNotFound(true);
      } else {
        setPage(data as unknown as PillarPage);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [curriculumSlug]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (notFound || !page) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <h1 className="text-3xl font-bold mb-4">Kurs nicht gefunden</h1>
        <p className="text-muted-foreground mb-8">
          Die angefragte Kursübersicht ist nicht verfügbar.
        </p>
        <Button asChild>
          <Link to="/">Zurück zur Startseite</Link>
        </Button>
      </div>
    );
  }

  const sections = page.sections_json || {};
  const h1 = sections.h1 || page.title;
  const intro = sections.intro || "";
  const breadcrumbs = sections.breadcrumbs || [];
  const internalLinks = sections.internal_links || [];
  const cta = sections.cta;
  const faqs = page.faq_json || [];
  const canonical = `${SITE_URL}/kurse/${page.slug}`;
  const description = page.meta_description || intro.slice(0, 160);

  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: h1,
    headline: h1,
    description,
    url: canonical,
    inLanguage: "de-DE",
    isPartOf: { "@type": "WebSite", name: "ExamFit", url: SITE_URL },
    hasPart: internalLinks.slice(0, 24).map((l) => ({
      "@type": "WebPage",
      name: l.label,
      url: l.href.startsWith("http") ? l.href : `${SITE_URL}${l.href}`,
    })),
  };

  const breadcrumbJsonLd = breadcrumbs.length
    ? {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: breadcrumbs.map((b, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: b.label,
          item: b.href ? `${SITE_URL}${b.href}` : canonical,
        })),
      }
    : null;

  const faqJsonLd = faqs.length
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a || f.a_seed || "" },
        })),
      }
    : null;

  return (
    <>
      <Helmet>
        <title>{page.title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonical} />
        <meta property="og:title" content={page.title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonical} />
        <meta property="og:type" content="website" />
        <script type="application/ld+json">
          {JSON.stringify(collectionJsonLd)}
        </script>
        {breadcrumbJsonLd && (
          <script type="application/ld+json">
            {JSON.stringify(breadcrumbJsonLd)}
          </script>
        )}
        {faqJsonLd && (
          <script type="application/ld+json">
            {JSON.stringify(faqJsonLd)}
          </script>
        )}
      </Helmet>

      <article className="container mx-auto px-4 py-8 max-w-4xl">
        {breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted-foreground">
            <ol className="flex flex-wrap gap-2">
              {breadcrumbs.map((b, i) => (
                <li key={i} className="flex items-center gap-2">
                  {i > 0 && <span>/</span>}
                  {b.href && i < breadcrumbs.length - 1 ? (
                    <Link to={b.href} className="hover:text-foreground">
                      {b.label}
                    </Link>
                  ) : (
                    <span aria-current="page">{b.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}

        <header className="mb-8">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">{h1}</h1>
          {intro && <p className="text-lg text-muted-foreground">{intro}</p>}
        </header>

        {sections.curriculum_overview && (
          <section className="mb-10 prose prose-neutral dark:prose-invert max-w-none">
            <h2>Curriculum-Überblick</h2>
            <p className="whitespace-pre-line">{sections.curriculum_overview}</p>
          </section>
        )}

        {sections.learning_journey && (
          <section className="mb-10 prose prose-neutral dark:prose-invert max-w-none">
            <h2>Lernpfad</h2>
            <p className="whitespace-pre-line">{sections.learning_journey}</p>
          </section>
        )}

        {sections.exam_strategy && (
          <section className="mb-10 prose prose-neutral dark:prose-invert max-w-none">
            <h2>Prüfungsstrategie</h2>
            <p className="whitespace-pre-line">{sections.exam_strategy}</p>
          </section>
        )}

        {internalLinks.length > 0 && (
          <nav aria-label="Themen-Übersicht" className="mb-10">
            <h2 className="text-2xl font-semibold mb-4">Alle Themen im Überblick</h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {internalLinks.map((l, i) => (
                <li key={i}>
                  <Link
                    to={l.href}
                    className="block p-4 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors text-sm font-medium"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {faqs.length > 0 && (
          <section className="mb-10">
            <h2 className="text-2xl font-semibold mb-4">Häufige Fragen</h2>
            <Accordion type="single" collapsible>
              {faqs.map((f, i) => (
                <AccordionItem key={i} value={`faq-${i}`}>
                  <AccordionTrigger>{f.q}</AccordionTrigger>
                  <AccordionContent className="whitespace-pre-line">
                    {f.a || f.a_seed || ""}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
        )}

        {cta && cta.href && (
          <div className="mt-10 flex justify-center">
            <Button asChild size="lg">
              <Link to={cta.href}>{cta.label || "Prüfung starten"}</Link>
            </Button>
          </div>
        )}
      </article>
    </>
  );
}
