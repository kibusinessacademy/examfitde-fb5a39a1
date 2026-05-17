import { Button } from '@/components/ui/button';
import { ArrowRight, Shield, Clock, CheckCircle, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { HeroAccent } from '@/components/marketing/HeroAccent';

interface Props {
  beruf: string;
  priceDisplay: string;
  onCtaClick: () => void;
}

/**
 * BundleHero — ATF-Hero für /bundle/:slug.
 * Headline + Nutzen + CTA + Trustline alle im 411x763-Viewport sichtbar.
 */
export function BundleHero({ beruf, priceDisplay, onCtaClick }: Props) {
  return (
    <section className="relative overflow-hidden py-10 md:py-16">
      <div className="absolute inset-0 bg-gradient-to-b from-primary/10 via-transparent to-transparent pointer-events-none" />
      <div className="relative max-w-3xl mx-auto px-4 text-center">
        <Badge variant="outline" className="mb-3 gap-1.5 border-primary/30 text-primary text-xs">
          <Zap className="h-3 w-3" />
          Komplettpaket · {beruf}
        </Badge>

        <h1 className="text-3xl sm:text-4xl md:text-5xl font-display font-bold leading-tight mb-3 md:mb-4">
          Alles, was du für deine Prüfung brauchst —{' '}
          <HeroAccent>in einem System.</HeroAccent>
        </h1>

        <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto mb-6 leading-snug">
          Lernkurs, Prüfungstrainer, KI-Tutor und mündliche Simulation greifen zusammen,
          damit du gezielt prüfungsreif wirst.
        </p>

        <div className="flex items-baseline justify-center gap-3 mb-5">
          <span className="text-4xl md:text-5xl font-bold text-foreground">{priceDisplay}</span>
          <span className="text-sm text-muted-foreground">einmalig</span>
        </div>

        <Button
          size="lg"
          className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8 text-base sm:text-lg w-full sm:w-auto"
          onClick={onCtaClick}
          data-cta-location="bundle_hero_primary"
        >
          Komplettpaket starten – {priceDisplay}
          <ArrowRight className="ml-2 h-5 w-5" />
        </Button>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 mt-5 text-xs sm:text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-accent" /> Einmalzahlung
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-accent" /> 12 Monate Zugang
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle className="h-3.5 w-3.5 text-accent" /> Kein Abo
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-accent" /> Sofort starten
          </span>
        </div>
      </div>
    </section>
  );
}
