import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

interface Props {
  priceDisplay: string;
  visible: boolean;
  onCtaClick: () => void;
}

/**
 * Sticky-CTA-Bar — erscheint mobil, wenn Hero aus dem Viewport scrollt.
 * Bleibt unaufdringlich (untere Kante), zeigt Preis + Primär-CTA.
 */
export function BundleStickyCta({ priceDisplay, visible, onCtaClick }: Props) {
  if (!visible) return null;
  return (
    <div className="fixed bottom-0 inset-x-0 z-40 bg-card/95 backdrop-blur-md border-t border-border px-4 py-3 safe-bottom md:hidden">
      <div className="max-w-md mx-auto flex items-center justify-between gap-3">
        <div className="flex flex-col min-w-0">
          <span className="text-lg font-bold text-text-primary leading-none">{priceDisplay}</span>
          <span className="text-[11px] text-text-secondary mt-0.5">Einmalzahlung · 12 Monate</span>
        </div>
        <Button
          className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-12 px-5 text-sm font-semibold shrink-0"
          onClick={onCtaClick}
          data-cta-location="bundle_sticky_cta"
        >
          Bundle starten
          <ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
