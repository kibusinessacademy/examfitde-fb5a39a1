import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Clock, Mic, BookOpenCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Props {
  beruf: string;
  kammer: string;
  description?: string | null;
  bundleHref: string;
  quizHref: string;
  onPrimaryCta: () => void;
  onSecondaryCta: () => void;
}

export function BerufHero({ beruf, kammer, description, bundleHref, quizHref, onPrimaryCta, onSecondaryCta }: Props) {
  return (
    <section className="relative overflow-hidden border-b border-border-subtle">
      <div
        className="absolute inset-0 -z-10 opacity-60"
        style={{
          background:
            'radial-gradient(ellipse at top, hsl(168 64% 90%) 0%, transparent 60%), radial-gradient(ellipse at bottom right, hsl(181 61% 90%) 0%, transparent 50%)',
        }}
        aria-hidden
      />
      <div
        className="absolute inset-0 -z-10 opacity-0 dark:opacity-40"
        style={{
          background:
            'radial-gradient(ellipse at top, hsl(168 64% 20%) 0%, transparent 60%), radial-gradient(ellipse at bottom right, hsl(181 64% 12%) 0%, transparent 50%)',
        }}
        aria-hidden
      />

      <div className="container max-w-4xl py-12 md:py-20 space-y-6">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{kammer}-Prüfung</Badge>
          <Badge variant="outline">Schriftlich &amp; mündlich</Badge>
        </div>

        <h1 className="text-3xl md:text-5xl font-display font-bold tracking-tight text-text-primary leading-[1.1]">
          Bereit für die {beruf}-Prüfung?
          <span className="block text-petrol-600 dark:text-mint-400 mt-2">
            Teste zuerst deine Prüfungsreife.
          </span>
        </h1>

        <p className="max-w-2xl text-base md:text-lg text-text-secondary leading-relaxed">
          ExamFit zeigt dir, welche Themen dich noch Punkte kosten, erstellt deinen Lernplan und
          trainiert dich mit Lernkurs, Prüfungsfragen, KI-Tutor und mündlicher Simulation.
        </p>

        {description && (
          <p className="max-w-2xl text-sm text-text-tertiary leading-relaxed">{description}</p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Button
            asChild
            size="lg"
            className="h-12 px-6 text-base"
            onClick={onPrimaryCta}
          >
            <Link to={quizHref}>
              Kostenlos Prüfungsreife testen
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="h-12 px-6 text-base"
            onClick={onSecondaryCta}
          >
            <Link to={bundleHref}>Komplettpaket ansehen</Link>
          </Button>
        </div>

        <ul className="flex flex-wrap gap-x-5 gap-y-2 pt-4 text-xs md:text-sm text-text-secondary">
          <li className="flex items-center gap-1.5">
            <BookOpenCheck className="h-4 w-4 text-petrol-600 dark:text-mint-400" />
            Rahmenplan-basiert
          </li>
          <li className="flex items-center gap-1.5">
            <Mic className="h-4 w-4 text-petrol-600 dark:text-mint-400" />
            Schriftlich &amp; mündlich
          </li>
          <li className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-petrol-600 dark:text-mint-400" />
            12 Monate Zugang
          </li>
          <li className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-petrol-600 dark:text-mint-400" />
            Kein Abo
          </li>
        </ul>
      </div>
    </section>
  );
}
