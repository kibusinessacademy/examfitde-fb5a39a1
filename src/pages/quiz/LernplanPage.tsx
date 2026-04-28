/**
 * LernplanPage — Personalisierter Lernplan basierend auf Quiz-Attempt.
 * Phase 2: Web-Seite mit Druck-CSS (PDF folgt in Phase 2.5).
 * Liest den Attempt (RLS erlaubt eigenen anonymen Versuch via owner-update-policy nicht für SELECT —
 * deshalb ziehen wir Topic-Schwächen aus den answers via attempts-Owner-Select wenn user_id matched,
 * sonst leiten wir den Plan aus den localStorage-Antworten ab — hier KISS:
 * Wir laden Quiz + zeigen Score/Plan auf Basis der URL-Params + Attempt (öffentlich-anon select fällt
 * unter quiz_attempts_owner_select; für anon owner_id NULL — daher kein direkter SELECT, Plan wird
 * aus generischen Topic-Tags + Score-Bereich abgeleitet).
 */
import { useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { SEOHead } from "@/components/seo/SEOHead";
import { SITE_URL } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trackFunnel } from "@/lib/conversionTracking";
import { CheckCircle2, Printer, ShoppingCart } from "lucide-react";
import { Link } from "react-router-dom";
import { useLeadQuiz } from "@/hooks/useLeadQuiz";

const PLAN_BY_SLUG: Record<
  string,
  { weeks: { week: number; focus: string; tasks: string[] }[]; bundleSlug?: string }
> = {
  "aevo-pruefungsreife": {
    bundleSlug: "ausbildereignungspruefung-aevo",
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

  const plan = useMemo(() => (slug ? PLAN_BY_SLUG[slug] : undefined), [slug]);

  useEffect(() => {
    if (slug) {
      trackFunnel("lernplan_view", {
        curriculum_id: quiz?.curriculum_id ?? null,
        metadata: { lernplan_slug: slug, attempt_id: attemptId },
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
          <div className="flex gap-3 mt-4 no-print">
            <Button onClick={() => window.print()} variant="outline">
              <Printer className="mr-2 h-4 w-4" /> Drucken / als PDF speichern
            </Button>
            {plan.bundleSlug && (
              <Button asChild>
                <Link to={`/bundle/${plan.bundleSlug}`}>
                  <ShoppingCart className="mr-2 h-4 w-4" />
                  Komplett-Bundle (24,90 €)
                </Link>
              </Button>
            )}
          </div>
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

        {plan.bundleSlug && (
          <Card className="mt-8 bg-primary/5 border-primary/20 no-print">
            <CardContent className="py-6 text-center">
              <h2 className="text-xl font-bold mb-2">
                Diesen Plan mit dem Komplett-Bundle umsetzen
              </h2>
              <p className="text-muted-foreground mb-4">
                Lernkurs, Prüfungstrainer & AI-Tutor für 24,90 € — alles, was du brauchst.
              </p>
              <Button asChild size="lg">
                <Link to={`/bundle/${plan.bundleSlug}`}>Bundle ansehen</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}
