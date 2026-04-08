import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Users, BarChart3, Shield } from 'lucide-react';
import { PRICING } from '@/config/pricing';
import { Link } from 'react-router-dom';

export function ProductB2BSection() {
  return (
    <section className="py-12 md:py-16">
      <div className="max-w-3xl mx-auto px-4 text-center">
        <Badge variant="outline" className="mb-4">Für Unternehmen &amp; Schulen</Badge>
        <h2 className="text-2xl md:text-3xl font-display font-bold mb-3">
          Mehrere Azubis ausbilden?
        </h2>
        <p className="text-muted-foreground max-w-xl mx-auto mb-8">
          Mengenrabatt ab 10 Lizenzen. Dashboard für Ausbilder mit Fortschritts-Tracking
          und Prüfungsreife-Monitoring.
        </p>

        <div className="grid sm:grid-cols-3 gap-4 max-w-2xl mx-auto mb-8">
          {PRICING.b2b.tiers.map((tier) => (
            <div key={tier.seats} className="p-4 rounded-xl border border-border bg-card text-center">
              <p className="text-sm text-muted-foreground">{tier.name}</p>
              <p className="text-2xl font-bold mt-1">{tier.unitPriceDisplay}</p>
              <p className="text-xs text-muted-foreground">pro Lizenz · ab {tier.seats} Lizenzen</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap justify-center gap-6 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5"><Users className="h-4 w-4 text-primary" /> Dashboard für Ausbilder</span>
          <span className="flex items-center gap-1.5"><BarChart3 className="h-4 w-4 text-primary" /> Fortschritts-Tracking</span>
          <span className="flex items-center gap-1.5"><Shield className="h-4 w-4 text-primary" /> DSGVO-konform</span>
        </div>
      </div>
    </section>
  );
}
