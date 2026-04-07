import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { SEOHead } from "@/components/seo/SEOHead";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, ArrowRight, BookOpen } from "lucide-react";
import ReactMarkdown from "react-markdown";

const SITE_URL = "https://examfitde.lovable.app";

type TrapPage = {
  id: string;
  slug: string;
  title: string;
  hook: string;
  content_md: string;
  trap_type: string;
  examples_json: Array<{
    question_text: string;
    options: Record<string, string>;
    correct_answer: string;
    explanation: string;
    difficulty: string;
  }>;
  seo_meta: { meta_description?: string };
  curriculum_title?: string;
};

export default function PruefungsfehlerPage() {
  const { slug } = useParams<{ slug: string }>();
  const [page, setPage] = useState<TrapPage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const { data } = await supabase
          .from("trap_content_pages" as any)
          .select("*")
          .eq("slug", slug)
          .eq("status", "published")
          .maybeSingle();

        if (data) {
          // Load curriculum title
          const { data: curr } = await supabase
            .from("curricula")
            .select("title")
            .eq("id", (data as any).curriculum_id)
            .single();

          setPage({ ...(data as any), curriculum_title: curr?.title });
        }
      } catch (err) {
        console.error("[PruefungsfehlerPage] fetch error", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!page) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
        <AlertTriangle className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-xl font-display font-bold">Seite nicht gefunden</h1>
        <p className="text-muted-foreground text-center">Dieser Prüfungsfehler-Artikel existiert nicht.</p>
        <Link to="/"><Button>Zur Startseite</Button></Link>
      </div>
    );
  }

  const pageUrl = `${SITE_URL}/pruefungsfehler/${page.slug}`;

  return (
    <>
      <SEOHead
        title={`${page.title} – ExamFit`}
        description={page.seo_meta?.meta_description || page.hook || `Typischer Prüfungsfehler: ${page.trap_type}`}
        canonical={pageUrl}
        type="article"
        structuredData={[{
          "@context": "https://schema.org",
          "@type": "Article",
          "headline": page.title,
          "description": page.hook,
          "publisher": { "@type": "Organization", "name": "ExamFit" },
          "url": pageUrl,
        }]}
      />

      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
        <div className="max-w-3xl mx-auto px-4 py-12">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <Badge variant="outline" className="text-amber-600 bg-amber-500/10">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Typischer Prüfungsfehler
              </Badge>
              {page.curriculum_title && (
                <Badge variant="secondary">{page.curriculum_title}</Badge>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground mb-3">
              {page.title}
            </h1>

            {page.hook && (
              <p className="text-lg text-muted-foreground font-medium">
                {page.hook}
              </p>
            )}
          </div>

          {/* Content */}
          <Card className="mb-8">
            <CardContent className="p-6 sm:p-8 prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown>{page.content_md || ""}</ReactMarkdown>
            </CardContent>
          </Card>

          {/* Example Questions */}
          {page.examples_json?.length > 0 && (
            <div className="mb-8">
              <h2 className="text-lg font-display font-bold mb-4 flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-primary" />
                Beispielfragen mit dieser Falle
              </h2>
              <div className="space-y-4">
                {page.examples_json.map((ex, i) => (
                  <Card key={i} className="border-muted">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <Badge variant="secondary" className="text-[10px]">Frage {i + 1}</Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {ex.difficulty === 'easy' ? 'Leicht' : ex.difficulty === 'medium' ? 'Mittel' : 'Schwer'}
                        </Badge>
                      </div>
                      <p className="text-sm font-medium mb-3">{ex.question_text}</p>
                      {ex.options && (
                        <div className="space-y-1.5 mb-3">
                          {Object.entries(ex.options).map(([key, val]) => (
                            <div
                              key={key}
                              className={`text-xs px-3 py-2 rounded-lg ${
                                key === ex.correct_answer
                                  ? 'bg-emerald-500/10 border border-emerald-500/20 font-medium'
                                  : 'bg-muted/50'
                              }`}
                            >
                              <span className="font-mono mr-2">{key})</span>
                              {String(val)}
                            </div>
                          ))}
                        </div>
                      )}
                      {ex.explanation && (
                        <p className="text-xs text-muted-foreground italic">💡 {ex.explanation}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* CTA */}
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-6 text-center">
              <h3 className="font-display font-bold text-lg mb-2">
                Diese Falle nie wieder tappen
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                ExamFit erkennt deine typischen Fehler und trainiert gezielt dagegen.
              </p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <Link to="/pruefungsreife-check">
                  <Button className="gradient-primary text-primary-foreground rounded-xl group w-full sm:w-auto">
                    Schwächen erkennen
                    <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </Link>
                <Link to="/shop">
                  <Button variant="outline" className="rounded-xl w-full sm:w-auto">
                    Prüfungstraining starten
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground mt-8">
            © ExamFit – Intelligentes Prüfungstraining
          </p>
        </div>
      </div>
    </>
  );
}
