import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowRight, CheckCircle, Clock, CreditCard } from 'lucide-react';
import type { ProductPageSSOT } from '@/types/product-page';

interface Props {
  product: ProductPageSSOT;
  onBuyClick: () => void;
  isLoading?: boolean;
}

function formatPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(amount);
}

export function ProductPricingCard({ product, onBuyClick, isLoading }: Props) {
  const { pricing } = product;
  const priceStr = formatPrice(pricing.amount, pricing.currency);

  return (
    <section className="py-12 md:py-16" id="pricing">
      <div className="max-w-md mx-auto px-4">
        <Card className="border-primary/30 shadow-lg overflow-hidden">
          {pricing.offerHighlight && (
            <div className="bg-primary text-primary-foreground text-center py-2 text-sm font-semibold">
              {pricing.offerHighlight}
            </div>
          )}
          <CardContent className="p-6">
            <div className="text-center mb-6">
              <p className="text-4xl font-display font-bold">{priceStr}</p>
              <p className="text-sm text-muted-foreground mt-1">{pricing.label}</p>
            </div>

            <div className="space-y-3 mb-6">
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-primary shrink-0" />
                <span>{pricing.accessDurationMonths} Monate Zugang</span>
              </div>
              {!pricing.isSubscription && (
                <div className="flex items-center gap-2 text-sm">
                  <CreditCard className="h-4 w-4 text-primary shrink-0" />
                  <span>Einmalzahlung – kein Abo</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                <span>Sofortiger Zugriff nach Kauf</span>
              </div>
            </div>

            <Button
              size="lg"
              className="w-full gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 text-lg"
              onClick={onBuyClick}
              disabled={isLoading}
            >
              {isLoading ? 'Wird geladen...' : product.ctas.primaryLabel}
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
