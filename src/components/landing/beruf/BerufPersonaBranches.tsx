import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { GraduationCap, Building2, School, ArrowRight } from 'lucide-react';

interface Props {
  beruf: string;
  quizHref: string;
  onCtaClick: (persona: 'azubi' | 'betrieb' | 'institution') => void;
}

export function BerufPersonaBranches({ beruf, quizHref, onCtaClick }: Props) {
  const branches = [
    {
      key: 'azubi' as const,
      icon: GraduationCap,
      headline: 'Du willst wissen, ob du wirklich prüfungsbereit bist?',
      points: [
        'Weniger Unsicherheit vor der Prüfung',
        'Klare Schwächenanalyse statt Bauchgefühl',
        'Echte Prüfungssimulation – schriftlich & mündlich',
        'Persönlicher KI-Coach mit Quellen aus dem Kurs',
      ],
      cta: 'Prüfungsreife testen',
      href: quizHref,
    },
    {
      key: 'betrieb' as const,
      icon: Building2,
      headline: 'Prüfungsrisiken früh erkennen, Ausbildungserfolg messbar machen.',
      points: [
        'Prüfungsreife je Auszubildendem',
        'Weniger Nachlernen kurz vor der Prüfung',
        'Standardisierte Vorbereitung im Betrieb',
        'Optional Mehrfachlizenzen',
      ],
      cta: 'Lizenzen für Auszubildende anfragen',
      href: '/unternehmen',
    },
    {
      key: 'institution' as const,
      icon: School,
      headline: 'Prüfungsvorbereitung, die Unterricht ergänzt – nicht ersetzt.',
      points: [
        'Rahmenplanorientiert',
        'Neutral und herstellerunabhängig',
        'Transparente Kompetenzstände',
        'Individuelle Vorbereitung pro Lernender',
      ],
      cta: 'ExamFit kennenlernen',
      href: '/unternehmen#institutionen',
    },
  ];

  return (
    <section className="container max-w-6xl py-12 md:py-16 space-y-8">
      <div className="max-w-2xl space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-petrol-600 dark:text-mint-400">
          Für wen passt ExamFit?
        </p>
        <h2 className="text-2xl md:text-3xl font-display font-bold text-text-primary">
          Drei Einstiege rund um die {beruf}-Prüfung.
        </h2>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {branches.map((b) => (
          <Card key={b.key} variant="elevated" className="flex flex-col">
            <CardContent className="py-6 px-5 flex flex-col h-full space-y-4">
              <div className="w-10 h-10 rounded-lg bg-mint-50 dark:bg-petrol-900/40 flex items-center justify-center">
                <b.icon className="h-5 w-5 text-petrol-600 dark:text-mint-400" />
              </div>
              <h3 className="font-semibold text-base text-text-primary leading-snug">
                {b.headline}
              </h3>
              <ul className="space-y-1.5 text-sm text-text-secondary flex-1">
                {b.points.map((p) => (
                  <li key={p} className="flex gap-2">
                    <span aria-hidden className="text-petrol-600 dark:text-mint-400 mt-0.5">•</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              <Button asChild variant="outline" className="w-full mt-2" onClick={() => onCtaClick(b.key)}>
                <Link to={b.href}>
                  {b.cta}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
