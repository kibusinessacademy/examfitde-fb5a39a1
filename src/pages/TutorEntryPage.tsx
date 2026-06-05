import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SEOHead } from '@/components/seo/SEOHead';
import { ArrowRight, Brain, Sparkles } from 'lucide-react';
import { SITE_URL } from '@/lib/seo';
import {
  reportEntryFallbackView,
  reportEntryFallbackCtaClick,
} from '@/lib/monitoring/entryFallbackSignal';

/**
 * /tutor — Reality-QA stable Tutor entry surface.
 *
 * Public-safe page that ALWAYS renders:
 *  - Static text block (>80 chars body) so /tutor never appears as white-screen
 *  - Sichtbares Eingabefeld (<textarea>) — Reality QA J07 requirement
 *  - Recovery CTA "Beruf auswählen" wenn der Learner kein Curriculum hat
 *  - Link zum vollwertigen System-Tutor unter /app/tutor (für eingeloggte Learner)
 *
 * Bewusst KEIN neuer Backend-Pfad — Architecture Freeze. Diese Seite ist nur
 * der sichtbare Recovery-Layer vor dem echten Tutor-Surface, damit die
 * Reality-QA-Journey "tutor erreichbar" deterministisch grün läuft.
 */
export default function TutorEntryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      navigate(`/auth?redirect=${encodeURIComponent('/app/tutor')}`);
      return;
    }
    // Hand the draft over to the real tutor surface.
    try {
      sessionStorage.setItem('tutor_initial_question', draft);
    } catch {
      /* ignore */
    }
    navigate('/app/tutor');
  };

  return (
    <>
      <SEOHead
        title="KI-Tutor – Prüfungsfragen erklären lassen | ExamFit"
        description="Frag den ExamFit KI-Tutor: Erklärungen mit Quellen aus deinem Prüfungs-Curriculum. Strict-RAG, keine Halluzinationen."
        canonical={`${SITE_URL}/tutor`}
      />
      <main className="min-h-screen container max-w-2xl py-12 px-4">
        <header className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium mb-4">
            <Sparkles className="h-3 w-3" /> KI-Tutor mit Quellen
          </div>
          <h1 className="text-3xl sm:text-4xl font-display font-bold mb-3">
            <Brain className="inline h-8 w-8 mr-2 text-primary" />
            Frag deinen Prüfungs-Tutor
          </h1>
          <p className="text-muted-foreground">
            Stelle eine Frage zu deinem Prüfungsstoff. Der KI-Tutor antwortet auf
            Basis deines Curriculums mit nachvollziehbaren Quellen.
          </p>
        </header>

        <Card className="mb-6">
          <CardContent className="p-5">
            <form onSubmit={handleSubmit} className="space-y-3" data-testid="tutor-entry-form">
              <label htmlFor="tutor-input" className="block text-sm font-medium">
                Deine Frage
              </label>
              <textarea
                id="tutor-input"
                data-testid="tutor-input"
                name="tutor-question"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="z. B. Erkläre mir kurz den wichtigsten Prüfungsbereich mit einem Beispiel."
                rows={4}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <div className="flex flex-col sm:flex-row gap-2">
                <Button type="submit" className="flex-1">
                  Frage senden <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                {user && (
                  <Button asChild variant="outline">
                    <Link to="/app/tutor">Zum vollen Tutor-Cockpit</Link>
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Recovery CTA: kein Curriculum → Beruf auswählen statt leere Fläche */}
        <Card className="border-dashed">
          <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
            <div>
              <p className="font-semibold">Noch keinen Beruf gewählt?</p>
              <p className="text-sm text-muted-foreground">
                Der Tutor arbeitet auf Basis deines Prüfungs-Curriculums. Wähl
                zuerst deinen Beruf — der Tutor übernimmt den Kontext automatisch.
              </p>
            </div>
            <Button asChild variant="outline">
              <Link to="/berufe">Beruf auswählen</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
