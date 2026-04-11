import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import type { ProductPageSSOT } from '@/types/product-page';

interface Props {
  product: ProductPageSSOT;
  onBuyClick: () => void;
  isLoading?: boolean;
}

export function ProductFinalCTABlock({ product, onBuyClick, isLoading }: Props) {
  const headline = product.finalCtaHeadline || 'Bereit für die Prüfung?';
  const copy = product.finalCtaCopy || 'Starte jetzt dein Prüfungstraining und bestehe sicher.';

  return (
    <section className="py-16 md:py-20">
      <div className="max-w-2xl mx-auto px-4 text-center">
        <h2 className="text-2xl md:text-4xl font-display font-bold mb-4">{headline}</h2>
        <p className="text-lg text-muted-foreground mb-8">{copy}</p>
        <Button
          size="lg"
          className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-10 text-lg"
          onClick={onBuyClick}
          disabled={isLoading}
        >
          {isLoading ? 'Wird geladen...' : product.ctas.primaryLabel}
          <ArrowRight className="ml-2 h-5 w-5" />
        </Button>
      </div>
    </section>
  );
}
