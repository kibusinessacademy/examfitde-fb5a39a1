import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Target, AlertTriangle, ArrowRight } from 'lucide-react';

interface Props {
  beruf: string;
  quizHref?: string;
}

export function BerufReadinessBlock({ beruf, quizHref }: Props) {
  return (
    <section className="container max-w-5xl py-12 md:py-16 space-y-8">
      <div className="max-w-2xl space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-petrol-600 dark:text-mint-400">
          Prüfungsreife messen
        </p>
        <h2 className="text-2xl md:text-3xl font-display font-bold text-text-primary">
          Du lernst nicht alles gleich stark.
        </h2>
        <p className="text-base text-text-secondary leading-relaxed">
          ExamFit priorisiert die Themen, die deine Prüfungsreife für die {beruf}-Prüfung am
          stärksten verbessern – statt dich quer durch jeden Rahmenplan-Punkt zu schicken.
        </p>
        {quizHref && (
          <div className="pt-2">
            <Button asChild variant="outline" size="lg" data-cta-location="beruf_readiness_quiz">
              <Link to={quizHref}>
                Prüfungsreife-Check starten
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        )}
      </div>


      <div className="grid md:grid-cols-3 gap-4">
        {/* Readiness-Score */}
        <Card variant="raised">
          <CardContent className="py-6 px-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                Prüfungsreife-Score
              </span>
              <Target className="h-4 w-4 text-petrol-600 dark:text-mint-400" />
            </div>
            <div className="flex items-end gap-1">
              <span className="text-4xl font-bold tabular-nums text-text-primary">72</span>
              <span className="text-sm text-text-tertiary mb-1">/ 100</span>
            </div>
            <Progress value={72} aria-label="Prüfungsreife 72 Prozent" />
            <p className="text-xs text-text-tertiary">
              In 4 Minuten ermittelt – ohne Anmeldung.
            </p>
          </CardContent>
        </Card>

        {/* Kompetenz-Mastery */}
        <Card variant="raised">
          <CardContent className="py-6 px-5 space-y-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              Kompetenz-Mastery
            </span>
            <ul className="space-y-3">
              {[
                { name: 'Rechnungswesen', value: 84 },
                { name: 'Warenwirtschaft', value: 58 },
                { name: 'Kundenkommunikation', value: 41 },
              ].map((c) => (
                <li key={c.name} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-text-secondary">{c.name}</span>
                    <span className="text-text-tertiary tabular-nums">{c.value}%</span>
                  </div>
                  <Progress value={c.value} aria-label={`${c.name} ${c.value} Prozent`} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Empfohlene Aktion */}
        <Card variant="raised">
          <CardContent className="py-6 px-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                Offene Schwächen
              </span>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </div>
            <p className="text-sm text-text-secondary leading-relaxed">
              3 Themen kosten dich aktuell die meisten Punkte. ExamFit baut deinen Lernplan
              automatisch um diese Lücken.
            </p>
            <div className="flex items-center gap-2 text-sm font-medium text-petrol-600 dark:text-mint-400">
              Nächste Aktion
              <ArrowRight className="h-4 w-4" />
            </div>
            <p className="text-sm text-text-primary">
              MiniCheck „Kundenkommunikation" – 8 Fragen, ~6 Min.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
