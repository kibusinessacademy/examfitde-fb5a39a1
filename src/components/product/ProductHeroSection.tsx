import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, ArrowRight, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ProductPageSSOT } from '@/types/product-page';

interface Props {
  product: ProductPageSSOT;
  onPrimaryClick: () => void;
  isLoading?: boolean;
}

export function ProductHeroSection({ product, onPrimaryClick, isLoading }: Props) {
  return (
    <section className="relative overflow-hidden py-12 md:py-20">
      <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />

      <div className="relative max-w-4xl mx-auto text-center px-4">
        {product.heroKicker && (
          <Badge variant="outline" className="mb-4 text-xs gap-1.5 border-primary/30 text-primary">
            <Sparkles className="h-3 w-3" />
            {product.heroKicker}
          </Badge>
        )}

        {product.badges.length > 0 && !product.heroKicker && (
          <div className="flex flex-wrap justify-center gap-2 mb-4">
            {product.badges.map((b) => (
              <Badge key={b.label} variant="outline" className="text-xs border-primary/30 text-primary">
                {b.label}
              </Badge>
            ))}
          </div>
        )}

        <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-display font-bold leading-tight mb-4 md:mb-6">
          {product.heroHeadline}
        </h1>

        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
          {product.heroSubline}
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
          <Button
            size="lg"
            className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8 text-lg w-full sm:w-auto"
            onClick={onPrimaryClick}
            disabled={isLoading}
          >
            {isLoading ? 'Wird geladen...' : product.ctas.primaryLabel}
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>

          {product.ctas.secondaryLabel && product.ctas.secondaryUrl && (
            <Button
              asChild
              variant="outline"
              size="lg"
              className="rounded-xl h-14 px-8 text-lg w-full sm:w-auto"
            >
              <Link to={product.ctas.secondaryUrl}>
                <Shield className="mr-2 h-5 w-5" />
                {product.ctas.secondaryLabel}
              </Link>
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-4 mt-6 text-xs text-muted-foreground">
          {!product.pricing.isSubscription && <span>✔ Kein Abo</span>}
          <span>✔ {product.pricing.accessDurationMonths} Monate Zugang</span>
          <span>✔ Sofortiger Start</span>
        </div>
      </div>
    </section>
  );
}
