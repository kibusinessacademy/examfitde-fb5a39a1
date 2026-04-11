import { Button } from '@/components/ui/button';
import { ArrowRight, Clock } from 'lucide-react';
import type { ProductPageSSOT } from '@/types/product-page';

interface Props {
  product: ProductPageSSOT;
  visible: boolean;
  onBuyClick: () => void;
  isLoading?: boolean;
}

function formatPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(amount);
}

export function StickyProductBar({ product, visible, onBuyClick, isLoading }: Props) {
  if (!visible) return null;

  const priceLabel = product.ctas.stickyPriceLabel || formatPrice(product.pricing.amount, product.pricing.currency);

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 bg-card/95 backdrop-blur-md border-t border-border px-4 py-3 safe-bottom">
      <div className="max-w-lg mx-auto flex items-center justify-between gap-3">
        <div className="flex flex-col min-w-0">
          <span className="text-lg font-bold text-foreground">{priceLabel}</span>
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" /> {product.pricing.accessDurationMonths} Monate · Kein Abo
          </span>
        </div>
        <Button
          className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-12 px-6 text-sm font-semibold shrink-0"
          onClick={onBuyClick}
          disabled={isLoading}
        >
          {isLoading ? '...' : product.ctas.stickyLabel}
          <ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
