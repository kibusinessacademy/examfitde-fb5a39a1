import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Clock, Mic, BookOpenCheck, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { BerufProductVisual } from './BerufProductVisual';

interface Props {
  beruf: string;
  kammer: string;
  description?: string | null;
  price: number;
  bundleHref: string;
  quizHref: string;
  productImageUrl?: string | null;
  onPrimaryCta: () => void;
  onSecondaryCta: () => void;
}

export function BerufHero({
  beruf,
  kammer,
  description,
  price,
  bundleHref,
  quizHref,
  productImageUrl,
  onPrimaryCta,
  onSecondaryCta,
}: Props) {
  const priceLabel = price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

      <div className="container max-w-6xl py-12 md:py-20">
        <div className="grid md:grid-cols-[1.2fr,1fr] gap-10 md:gap-12 items-start">
          {/* Linke Spalte: Produktversprechen */}
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{kammer}-Prüfung</Badge>
              <Badge variant="outline">Schriftlich &amp; mündlich</Badge>
            </div>

            <h1 className="text-3xl md:text-5xl font-display font-bold tracking-tight text-text-primary leading-[1.1]">
              Prüfungstraining
              <span className="block text-petrol-600 dark:text-mint-400 mt-2">{beruf}</span>
            </h1>

            <p className="max-w-xl text-base md:text-lg text-text-secondary leading-relaxed">
              Bestehe deine {kammer}-Abschlussprüfung mit einem strukturierten Prüfungstraining
              aus Lernkurs, Prüfungssimulation, KI-Tutor und mündlicher Übung.
            </p>

            {description && (
              <p className="max-w-xl text-sm text-text-tertiary leading-relaxed">{description}</p>
            )}

            <ul className="grid grid-cols-2 gap-y-2 gap-x-4 max-w-md text-sm text-text-secondary">
              <li className="flex items-center gap-1.5">
                <BookOpenCheck className="h-4 w-4 text-petrol-600 dark:text-mint-400 shrink-0" />
                Lernkurs
              </li>
              <li className="flex items-center gap-1.5">
                <Mic className="h-4 w-4 text-petrol-600 dark:text-mint-400 shrink-0" />
                Mündliche Prüfung
              </li>
              <li className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-petrol-600 dark:text-mint-400 shrink-0" />
                Prüfungssimulation
              </li>
              <li className="flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-petrol-600 dark:text-mint-400 shrink-0" />
                12 Monate Zugang
              </li>
            </ul>

            <div className="pt-2">
              <Link
                to={quizHref}
                onClick={onSecondaryCta}
                className="text-sm font-medium text-petrol-600 dark:text-mint-400 underline-offset-4 hover:underline"
              >
                Lieber erst kostenlos die Prüfungsreife testen →
              </Link>
            </div>
          </div>

          {/* Rechte Spalte: Kaufbox mit Bild, Preis, CTA */}
          <Card variant="raised" className="md:sticky md:top-24">
            <CardContent className="p-5 space-y-5">
              <BerufProductVisual beruf={beruf} kammer={kammer} imageUrl={productImageUrl} />

              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-display font-bold text-text-primary">
                  {priceLabel} €
                </span>
                <span className="text-sm text-text-tertiary">einmalig</span>
              </div>

              <ul className="space-y-1.5 text-sm text-text-secondary">
                <li className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-petrol-600 dark:text-mint-400 shrink-0" />
                  Kein Abo – einmalige Zahlung
                </li>
                <li className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-petrol-600 dark:text-mint-400 shrink-0" />
                  Sofortiger Zugriff, 12 Monate gültig
                </li>
              </ul>

              <Button asChild size="lg" className="w-full h-12 text-base" onClick={onPrimaryCta}>
                <Link to={bundleHref}>
                  Jetzt Prüfungstraining starten
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
