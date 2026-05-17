/**
 * LernplanPage — Personalisierter Lernplan basierend auf Quiz-Attempt.
 * Phase 2: Web-Seite mit Druck-CSS + Phase 2.5 PDF-Download via Edge Function.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { SEOHead } from "@/components/seo/SEOHead";
import { SITE_URL } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { emitFunnelEvent } from "@/lib/funnelEvents";
import { getQuizBundleMapping } from "@/lib/quizBundleMap";
import {
  CheckCircle2,
  Printer,
  ShoppingCart,
  FileDown,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { useLeadQuiz } from "@/hooks/useLeadQuiz";

const PLAN_BY_SLUG: Record<
  string,
  { weeks: { week: number; focus: string; tasks: string[] }[] }
> = {
  "aevo-pruefungsreife": {
    weeks: [
      {
        week: 1,
        focus: "Grundlagen & Recht (BBiG, JArbSchG, AusbVO)",
        tasks: [
          "Lernkarten Recht durcharbeiten (60 Min)",
          "10 Multiple-Choice-Fragen Recht (Trainer)",
          "Mini-Check: Mindestinhalte Ausbildungsvertrag",
        ],
      },
      {
        week: 2,
        focus: "Handlungsfeld 1 & 2: Voraussetzungen prüfen, Ausbildung vorbereiten",
        tasks: [
          "Ausbildungsplan-Vorlage selbst erstellen",
          "Eignung Ausbilder/Betrieb wiederholen",
          "Übung: Probezeit & Kündigung",
        ],
      },
      {
        week: 3,
        focus: "Handlungsfeld 3: Ausbildung durchführen — Methodik",
        tasks: [
          "Vier-Stufen-Methode in eigenen Worten erklären",
          "Lehrgespräch vs. Lernauftrag vergleichen",
          "Praktische Unterweisung (15 Min) skizzieren",
        ],
      },
      {
        week: 4,
        focus: "Prüfungssimulation",
        tasks: [
          "Schriftliche Probeprüfung (180 Min) komplett",
          "Praktische Präsentation üben (15 Min) + Fachgespräch (15 Min)",
          "AI-Tutor: 3 mündliche Prüfungssimulationen",
        ],
      },
    ],
  },
};

export default function LernplanPage() {
  const { slug } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const attemptId = params.get("attempt");
  const { data: quiz } = useLeadQuiz(slug);
  const { toast } = useToast();

  const plan = useMemo(() => (slug ? PLAN_BY_SLUG[slug] : undefined), [slug]);
  const mapping = useMemo(() => getQuizBundleMapping(slug), [slug]);

  const [pdfState, setPdfState] = useState<"idle" | "loading" | "error">("idle");
  const [pdfAttempts, setPdfAttempts] = useState(0);

  async function handleDownloadPdf() {
    if (!slug) return;
    setPdfState("loading");
    try {
      const { data, error } = await supabase.functions.invoke("lernplan-pdf", {
        body: { slug, attempt_id: attemptId },
      });
      if (error) throw error;
      const url = (data as any)?.url;
      if (!url) throw new Error("no_url");
      window.open(url, "_blank", "noopener,noreferrer");
      setPdfState("idle");
      toast({
        title: "Lernplan geöffnet",
        description: "Über das Browser-Druckdialog als PDF speichern.",
      });
    } catch (err) {
      console.warn("[lernplan-pdf] failed:", err);
      setPdfState("error");
      setPdfAttempts((n) => n + 1);
    }
  }

  useEffect(() => {
    if (slug) {
      emitFunnelEvent("LERNPLAN_VIEWED", {
        curriculum_id: quiz?.curriculum_id ?? null,
        lernplan_slug: slug,
        attempt_id: attemptId,
      });
    }
  }, [slug, quiz?.curriculum_id, attemptId]);

  if (!plan) {
    return (
      <main className="container mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold mb-2">Lernplan nicht gefunden</h1>
        <p className="text-muted-foreground">
          Bitte starte den Selbsttest erneut.
        </p>
      </main>
    );
  }

  return (
    <>
      <SEOHead
        title={`Dein persönlicher Lernplan – ${quiz?.title ?? "ExamFit"}`}
        description="Dein individueller 4-Wochen-Lernplan zur Prüfungsvorbereitung."
        canonical={`${SITE_URL}/lernplan/${slug}`}
        noindex
      />
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
          .lernplan-card { break-inside: avoid; box-shadow: none !important; border: 1px solid #ddd; }
          main { padding: 0 !important; }
        }
      `}</style>
      <main className="container mx-auto px-4 py-10 md:py-14 max-w-3xl">
        <header className="mb-8">
          <p className="text-sm text-primary font-medium mb-2">Dein 4-Wochen-Lernplan</p>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">
            {quiz?.title ?? "Persönlicher Lernplan"}
          </h1>
          <p className="text-muted-foreground">
            Schritt-für-Schritt zur Prüfungsreife. Du kannst diesen Plan ausdrucken
            oder als PDF speichern.
          </p>

          {!mapping && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive-bg-subtle p-3 text-sm text-destructive no-print">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Konfigurationsfehler: Für dieses Quiz ist kein Bundle-Mapping
                hinterlegt. Bitte den Support kontaktieren.
              </span>
            </div>
          )}

          <div className="flex flex-wrap gap-3 mt-4 no-print">
            <Button onClick={() => window.print()} variant="outline">
              <Printer className="mr-2 h-4 w-4" /> Drucken / als PDF speichern
            </Button>
            <Button
              onClick={handleDownloadPdf}
              variant="outline"
              disabled={pdfState === "loading"}
            >
              {pdfState === "loading" ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Wird erzeugt…
                </>
              ) : pdfState === "error" ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" /> Erneut versuchen
                  {pdfAttempts > 1 && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({pdfAttempts}×)
                    </span>
                  )}
                </>
              ) : (
                <>
                  <FileDown className="mr-2 h-4 w-4" /> PDF herunterladen
                </>
              )}
            </Button>
            {mapping && (
              <Button
                asChild
                onClick={() =>
                  emitFunnelEvent("BUNDLE_CTA_CLICKED", {
                    curriculum_id: quiz?.curriculum_id ?? null,
                    bundle_slug: mapping.bundleSlug,
                    cta_location: "lernplan_header",
                  })
                }
              >
                <Link to={`/bundle/${mapping.bundleSlug}`}>
                  <ShoppingCart className="mr-2 h-4 w-4" />
                  Komplettpaket (24,90 €)
                </Link>
              </Button>
            )}
          </div>

          {pdfState === "error" && (
            <p className="mt-2 text-xs text-destructive no-print">
              PDF konnte nicht erstellt werden. Bitte erneut versuchen oder den
              Druck-Button nutzen.
            </p>
          )}
        </header>

        <div className="space-y-4">
          {plan.weeks.map((w) => (
            <Card key={w.week} className="lernplan-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-bold">
                    {w.week}
                  </span>
                  Woche {w.week}: {w.focus}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {w.tasks.map((t, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>

        {mapping && (
          <Card className="mt-8 bg-primary/5 border-primary/20 no-print">
            <CardContent className="py-6 text-center">
              <h2 className="text-xl font-bold mb-2">
                Diesen Plan mit dem Komplettpaket umsetzen
              </h2>
              <p className="text-muted-foreground mb-4">
                Lernkurs, Prüfungstrainer & AI-Tutor für 24,90 € — alles, was du brauchst.
              </p>
              <Button
                asChild
                size="lg"
                onClick={() =>
                  emitFunnelEvent("BUNDLE_CTA_CLICKED", {
                    curriculum_id: quiz?.curriculum_id ?? null,
                    bundle_slug: mapping.bundleSlug,
                    cta_location: "lernplan_footer",
                  })
                }
              >
                <Link to={`/bundle/${mapping.bundleSlug}`}>Bundle ansehen</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}
