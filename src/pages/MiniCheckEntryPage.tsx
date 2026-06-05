import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SEOHead } from '@/components/seo/SEOHead';
import { ArrowRight, Brain, Target, Sparkles } from 'lucide-react';
import { SITE_URL } from '@/lib/seo';
import {
  reportEntryFallbackView,
  reportEntryFallbackCtaClick,
} from '@/lib/monitoring/entryFallbackSignal';

/**
 * /minicheck and /minicheck/:sessionId — Reality-QA stable MiniCheck entry.
 *
 * Why this page exists (P0.4, 2026-06-05):
 *   The deterministic Dashboard Next-Step resolver
 *   (src/features/activation/resolveDashboardNextStep.ts) can route the
 *   learner to /minicheck or /minicheck/:sessionId. Until this page existed,
 *   both produced HTTP 404 and surfaced as `broken_route` P0s in the
 *   Customer Reality Gate.
 *
 *   This page is the visible *entry/recovery* surface in front of the
 *   in-course MiniCheck engine (which lives at /app/minicheck and is
 *   FROZEN under Architecture Freeze — Agent OS). It guarantees:
 *     - Sync-rendered body (>80 chars) → no white_screen.
 *     - Stable "Start" CTA (data-testid="minicheck-start-cta") → no
 *       "no question reached" finding when the journey lands here
 *       cold and there is no in-course session yet.
 *     - Recovery CTA "Beruf auswählen" when no curriculum context exists.
 *     - Forwards the curriculum query param + optional sessionId path
 *       param to /app/minicheck so the real engine picks up context.
 */
export default function MiniCheckEntryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const [search] = useSearchParams();
  const curriculumId = search.get('curriculum');

  const handleStart = () => {
    if (!user) {
      const next = sessionId ? `/app/minicheck/${sessionId}` : '/app/minicheck';
      navigate(`/auth?redirect=${encodeURIComponent(next)}`);
      return;
    }
    if (sessionId) {
      navigate(`/app/minicheck/${sessionId}`);
      return;
    }
    if (curriculumId) {
      navigate(`/app/minicheck?curriculum=${encodeURIComponent(curriculumId)}`);
      return;
    }
    navigate('/app/minicheck');
  };

  const headline = sessionId
    ? 'MiniCheck fortsetzen'
    : 'Starte deinen MiniCheck';

  const subline = sessionId
    ? 'Wir setzen genau dort an, wo du aufgehört hast — keine Frage geht verloren.'
    : 'Fünf gezielte Fragen zeigen dir in unter zwei Minuten, wo deine größten Lücken liegen. Dein Lernplan kalibriert sich automatisch.';

  return (
    <>
      <SEOHead
        title="MiniCheck – Wissensstand in 2 Minuten messen | ExamFit"
        description="Starte deinen MiniCheck: 5 gezielte Fragen, die deinen Wissensstand kalibrieren. Sofort sichtbarer Lernplan, keine Halluzinationen."
        canonical={`${SITE_URL}/minicheck`}
      />

      <main
        className="min-h-screen container max-w-2xl py-12 px-4"
        data-testid="minicheck-static-anchor"
      >
        <header className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium mb-4">
            <Sparkles className="h-3 w-3" /> Kompetenz-Check
          </div>
          <h1 className="text-3xl sm:text-4xl font-display font-bold mb-3">
            <Brain className="inline h-8 w-8 mr-2 text-primary" />
            {headline}
          </h1>
          <p className="text-muted-foreground">{subline}</p>
        </header>

        <Card className="mb-6 border-primary/30">
          <CardContent className="p-5 sm:p-6">
            <div className="space-y-4">
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <Target className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  <span>5 Fragen aus deinem Curriculum — adaptiv ausgewählt.</span>
                </li>
                <li className="flex items-start gap-2">
                  <Target className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  <span>Sofort-Feedback mit Quellenangaben (Strict-RAG).</span>
                </li>
                <li className="flex items-start gap-2">
                  <Target className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  <span>
                    Ergebnis fließt direkt in deinen 4-Wochen-Lernplan ein.
                  </span>
                </li>
              </ul>

              <Button
                size="lg"
                className="w-full"
                onClick={handleStart}
                data-testid="minicheck-start-cta"
                data-cta-location="minicheck_entry_start"
              >
                {sessionId ? 'MiniCheck fortsetzen' : 'MiniCheck starten'}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Recovery CTA: no curriculum → choose Beruf instead of dead state */}
        {!curriculumId && !sessionId && (
          <Card className="border-dashed">
            <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
              <div>
                <p className="font-semibold">Noch keinen Beruf gewählt?</p>
                <p className="text-sm text-muted-foreground">
                  Der MiniCheck arbeitet auf Basis deines Prüfungs-Curriculums.
                  Wähle zuerst deinen Beruf — der Lernplan kalibriert sich dann
                  automatisch.
                </p>
              </div>
              <Button asChild variant="outline">
                <Link to="/berufe">Beruf auswählen</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}
