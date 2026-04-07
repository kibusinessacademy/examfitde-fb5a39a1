import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { SEOHead } from "@/components/seo/SEOHead";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, HelpCircle, ArrowRight, CheckCircle, XCircle, Share2 } from "lucide-react";
import ReactMarkdown from "react-markdown";

const SITE_URL = "https://examfitde.lovable.app";

type DailyQuestion = {
  id: string;
  day: string;
  slug: string;
  hook: string;
  explanation_md: string;
  social_captions: Record<string, string>;
  exam_question: {
    question_text: string;
    options: Record<string, string>;
    correct_answer: string;
    explanation: string;
    difficulty: string;
    trap_tags: string[];
  };
  curriculum: {
    title: string;
    slug: string;
  };
};

function ShareButtons({ url, text }: { url: string; text: string }) {
  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <a
        href={`https://wa.me/?text=${encodedText}%20${encodedUrl}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 text-xs font-medium hover:bg-emerald-500/20 transition-colors"
      >
        WhatsApp
      </a>
      <a
        href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-600 text-xs font-medium hover:bg-blue-500/20 transition-colors"
      >
        LinkedIn
      </a>
      <a
        href={`https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-foreground/5 text-foreground text-xs font-medium hover:bg-foreground/10 transition-colors"
      >
        X / Twitter
      </a>
    </div>
  );
}

export default function FrageDesTagsPage() {
  const { slug } = useParams<{ slug?: string }>();
  const [data, setData] = useState<DailyQuestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        let query = supabase
          .from("daily_question_picks" as any)
          .select(`
            id, day, slug, hook, explanation_md, social_captions,
            exam_question:exam_question_id (
              question_text, options, correct_answer, explanation, difficulty, trap_tags
            )
          `)
          .eq("status", "published")
          .order("day", { ascending: false });

        if (slug) {
          query = query.eq("slug", slug);
        }

        const { data: picks } = await query.limit(1).single();

        if (picks) {
          // Load curriculum
          const { data: currData } = await supabase
            .from("curricula")
            .select("title, slug")
            .eq("id", (picks as any).curriculum_id)
            .single();

          setData({
            ...picks as any,
            curriculum: currData || { title: "Berufsausbildung", slug: "beruf" },
          });
        }
      } catch (err) {
        console.error("[FrageDesTagsPage] fetch error", err);
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

  if (!data || !data.exam_question) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
        <HelpCircle className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-xl font-display font-bold">Keine Frage verfügbar</h1>
        <p className="text-muted-foreground text-center">Die Frage des Tages ist noch nicht verfügbar.</p>
        <Link to="/"><Button>Zur Startseite</Button></Link>
      </div>
    );
  }

  const q = data.exam_question;
  const options = typeof q.options === 'object' ? q.options : {};
  const pageUrl = `${SITE_URL}/frage-des-tages/${data.slug}`;
  const isCorrect = selectedAnswer === q.correct_answer;

  return (
    <>
      <SEOHead
        title={`Frage des Tages: ${data.curriculum?.title || 'IHK-Prüfung'} – ExamFit`}
        description={data.hook || `Teste dein Wissen mit der ExamFit Frage des Tages für ${data.curriculum?.title}`}
        canonical={pageUrl}
        type="article"
        structuredData={[{
          "@context": "https://schema.org",
          "@type": "Quiz",
          "name": `Frage des Tages – ${data.curriculum?.title}`,
          "about": { "@type": "Thing", "name": data.curriculum?.title },
          "datePublished": data.day,
          "publisher": { "@type": "Organization", "name": "ExamFit" },
          "url": pageUrl,
        }]}
      />

      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
        <div className="max-w-2xl mx-auto px-4 py-12">
          {/* Header */}
          <div className="text-center mb-8">
            <Badge variant="outline" className="mb-3">
              <HelpCircle className="h-3 w-3 mr-1" />
              Frage des Tages · {new Date(data.day).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}
            </Badge>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground mb-2">
              Frage des Tages
            </h1>
            <p className="text-muted-foreground">{data.curriculum?.title}</p>
          </div>

          {/* Hook */}
          {data.hook && (
            <p className="text-center text-lg font-medium text-primary mb-8">
              {data.hook}
            </p>
          )}

          {/* Question Card */}
          <Card className="mb-6 border-primary/10">
            <CardContent className="p-6">
              <div className="flex items-start gap-2 mb-4">
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {q.difficulty === 'easy' ? 'Leicht' : q.difficulty === 'medium' ? 'Mittel' : 'Schwer'}
                </Badge>
                {q.trap_tags?.length > 0 && (
                  <Badge variant="outline" className="shrink-0 text-[10px] text-amber-600">
                    ⚠️ Enthält Falle
                  </Badge>
                )}
              </div>

              <h2 className="text-lg font-semibold mb-6">{q.question_text}</h2>

              {/* Answer Options */}
              <div className="space-y-3">
                {Object.entries(options).map(([key, value]) => {
                  const isSelected = selectedAnswer === key;
                  const isAnswer = q.correct_answer === key;
                  const showResult = revealed;

                  return (
                    <button
                      key={key}
                      onClick={() => {
                        if (!revealed) {
                          setSelectedAnswer(key);
                          setRevealed(true);
                        }
                      }}
                      disabled={revealed}
                      className={`w-full text-left p-4 rounded-xl border transition-all ${
                        showResult && isAnswer
                          ? 'border-emerald-500 bg-emerald-500/10'
                          : showResult && isSelected && !isAnswer
                          ? 'border-rose-500 bg-rose-500/10'
                          : isSelected
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50 hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="font-mono text-sm font-bold text-muted-foreground shrink-0 mt-0.5">
                          {key})
                        </span>
                        <span className="text-sm">{String(value)}</span>
                        {showResult && isAnswer && (
                          <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0 ml-auto" />
                        )}
                        {showResult && isSelected && !isAnswer && (
                          <XCircle className="h-5 w-5 text-rose-500 shrink-0 ml-auto" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Result */}
              {revealed && (
                <div className={`mt-6 p-4 rounded-xl ${isCorrect ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-amber-500/10 border border-amber-500/20'}`}>
                  <p className="font-semibold mb-1">
                    {isCorrect ? '✅ Richtig!' : '❌ Leider falsch!'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Die richtige Antwort ist <strong>{q.correct_answer}</strong>.
                    {q.explanation && ` ${q.explanation}`}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Trap Explanation */}
          {revealed && q.trap_tags?.length > 0 && (
            <Card className="mb-6 border-amber-500/20 bg-amber-500/5">
              <CardContent className="p-6">
                <h3 className="font-semibold text-amber-700 mb-2">⚠️ Typische Falle</h3>
                <p className="text-sm text-muted-foreground">
                  {q.trap_tags.join(" · ")}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Detailed Explanation */}
          {revealed && data.explanation_md && (
            <Card className="mb-6">
              <CardContent className="p-6 prose prose-sm max-w-none dark:prose-invert">
                <h3 className="text-base font-semibold mb-3">📖 Ausführliche Erklärung</h3>
                <ReactMarkdown>{data.explanation_md}</ReactMarkdown>
              </CardContent>
            </Card>
          )}

          {/* Share */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <Share2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Teilen</span>
            </div>
            <ShareButtons
              url={`${pageUrl}?utm_source=share&utm_medium=social&utm_campaign=frage-des-tages`}
              text={`🎯 Kannst du diese IHK-Prüfungsfrage beantworten? Teste dich auf ExamFit!`}
            />
          </div>

          {/* CTA */}
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-6 text-center">
              <h3 className="font-display font-bold text-lg mb-2">
                Bereit für die echte Prüfung?
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                ExamFit analysiert deine Schwächen und trainiert gezielt – mit tausenden prüfungsnahen Fragen.
              </p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <Link to="/pruefungsreife-check">
                  <Button className="gradient-primary text-primary-foreground rounded-xl group w-full sm:w-auto">
                    Prüfungsreife kostenlos testen
                    <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </Link>
                <Link to="/shop">
                  <Button variant="outline" className="rounded-xl w-full sm:w-auto">
                    Prüfungstraining ansehen
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground mt-8">
            © ExamFit – Intelligentes Prüfungstraining · Täglich neue Fragen
          </p>
        </div>
      </div>
    </>
  );
}
