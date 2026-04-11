import { CheckCircle } from 'lucide-react';
import type { TrustItem } from '@/types/product-page';

interface Props {
  items: TrustItem[];
}

export function ProductTrustBar({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <section className="py-6 border-y border-border bg-muted/30">
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
          {items.map((item) => (
            <div key={item.label} className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle className="h-4 w-4 text-primary shrink-0" />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
