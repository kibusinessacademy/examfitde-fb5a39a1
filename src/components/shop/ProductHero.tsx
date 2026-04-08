import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Shield, Sparkles, ArrowRight } from 'lucide-react';
import { PRICING } from '@/config/pricing';
import { Link } from 'react-router-dom';

interface Props {
  title: string;
  chamberType: string;
  catalogType: string;
  onBuyClick: () => void;
  isCheckoutLoading: boolean;
  priceDisplay: string;
}

export function ProductHero({ title, chamberType, catalogType, onBuyClick, isCheckoutLoading, priceDisplay }: Props) {
  const cleanTitle = title
    .replace(/^Rahmenlehrplan\s+/i, '')
    .replace(/^Modulhandbuch\s+/i, '');

  return (
    <section className="relative overflow-hidden py-12 md:py-20">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />
      
      <div className="relative max-w-4xl mx-auto text-center px-4">
        <Badge variant="outline" className="mb-4 text-xs gap-1.5 border-primary/30 text-primary">
          <Sparkles className="h-3 w-3" />
          {chamberType}-zertifiziert · {catalogType}
        </Badge>

        <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-display font-bold leading-tight mb-4 md:mb-6">
          Bestehe deine Abschlussprüfung als{' '}
          <span className="text-gradient">{cleanTitle}</span>{' '}
          – systematisch &amp; sicher
        </h1>

        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
          Trainiere exakt das, was in der {chamberType}-Prüfung drankommt.
          Mit echten Prüfungsaufgaben, Simulationen und persönlichem KI-Prüfungscoach.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
          <Button
            size="lg"
            className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8 text-lg w-full sm:w-auto"
            onClick={onBuyClick}
            disabled={isCheckoutLoading}
          >
            {isCheckoutLoading ? 'Wird geladen...' : `Jetzt Prüfungstraining starten – ${priceDisplay}`}
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="rounded-xl h-14 px-8 text-lg w-full sm:w-auto"
          >
            <Link to="/pruefungsreife-check">
              <Shield className="mr-2 h-5 w-5" />
              Kostenlos: Prüfungsreife testen
            </Link>
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-4 mt-6 text-xs text-muted-foreground">
          <span>✔ Kein Abo</span>
          <span>✔ {PRICING.defaultAccess} Zugang</span>
          <span>✔ Sofortiger Start</span>
        </div>
      </div>
    </section>
  );
}
