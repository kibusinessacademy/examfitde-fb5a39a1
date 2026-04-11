import { CheckCircle } from 'lucide-react';
import type { ProductPageSSOT } from '@/types/product-page';

interface Props {
  product: ProductPageSSOT;
}

export function ProductProfessionFitBlock({ product }: Props) {
  if (product.roleFitItems.length === 0) return null;

  const headline = product.professionFitHeadline || `Perfekt für ${product.berufDisplayName || 'dich'}`;

  return (
    <section className="py-12 md:py-16">
      <div className="max-w-3xl mx-auto px-4">
        <div className="text-center mb-8">
          <p className="text-primary font-semibold text-sm uppercase tracking-wider mb-2">Zielgruppe</p>
          <h2 className="text-2xl md:text-3xl font-display font-bold">{headline}</h2>
          {product.professionFitCopy && (
            <p className="text-muted-foreground mt-2">{product.professionFitCopy}</p>
          )}
        </div>

        <div className="space-y-3 max-w-md mx-auto">
          {product.roleFitItems.map((item) => (
            <div key={item.title} className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">{item.title}</p>
                {item.copy && <p className="text-xs text-muted-foreground">{item.copy}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
