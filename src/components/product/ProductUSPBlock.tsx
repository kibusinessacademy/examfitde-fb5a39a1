import type { ProductPageSSOT } from '@/types/product-page';
import { Zap } from 'lucide-react';

interface Props {
  product: ProductPageSSOT;
}

export function ProductUSPBlock({ product }: Props) {
  const headline = product.uspHeadline || 'ExamFit ist kein Kurs.';
  const copy = product.uspCopy || 'Es ist ein intelligentes Prüfungstrainings-System. Du trainierst nicht Inhalte – du trainierst die Prüfung.';

  return (
    <section className="py-12 md:py-16 text-center">
      <div className="max-w-3xl mx-auto px-4">
        <p className="text-primary font-semibold text-sm uppercase tracking-wider mb-3">Die Lösung</p>
        <h2 className="text-2xl md:text-4xl font-display font-bold mb-4">{headline}</h2>
        <p className="text-xl md:text-2xl text-muted-foreground">{copy}</p>

        {product.uspItems.length > 0 && (
          <div className="grid sm:grid-cols-2 gap-4 mt-10 text-left max-w-2xl mx-auto">
            {product.uspItems.map((item) => (
              <div key={item.title} className="flex items-start gap-3 p-4 rounded-xl bg-card border border-border">
                <Zap className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">{item.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.copy}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
