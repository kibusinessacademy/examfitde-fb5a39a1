import { AlertTriangle } from 'lucide-react';
import type { ProductPageSSOT } from '@/types/product-page';

interface Props {
  product: ProductPageSSOT;
}

const DEFAULT_PAIN_HEADLINE = 'Viele lernen monatelang – und fallen trotzdem durch.';
const DEFAULT_PAIN_COPY =
  'Zu viel Theorie, zu wenig Prüfungspraxis. Keine echten Prüfungsfragen zum Üben. Unsicherheit: „Reicht das, was ich kann?"';

export function ProductPainBlock({ product }: Props) {
  const headline = product.painHeadline || DEFAULT_PAIN_HEADLINE;
  const copy = product.painCopy || DEFAULT_PAIN_COPY;

  return (
    <section className="py-12 md:py-16 bg-destructive/5 rounded-3xl mx-2 sm:mx-0">
      <div className="max-w-3xl mx-auto px-4 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-destructive/10 text-destructive mb-6">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm font-medium">Die Realität</span>
        </div>

        <h2 className="text-2xl md:text-3xl font-display font-bold mb-4">
          {headline}
        </h2>

        <p className="text-muted-foreground text-lg whitespace-pre-line">
          {copy}
        </p>

        <p className="mt-8 text-muted-foreground text-lg">
          → Ergebnis: <strong className="text-foreground">Stress, Zweifel oder Durchfallen</strong>
        </p>
      </div>
    </section>
  );
}
