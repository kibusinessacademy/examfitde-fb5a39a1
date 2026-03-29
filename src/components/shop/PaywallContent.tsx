import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, Lock, Loader2, ShoppingCart, Clock, Sparkles } from 'lucide-react';
import type { ResolvedPaywall } from '@/hooks/useResolvePaywall';

interface PaywallContentProps {
  paywall: ResolvedPaywall | null;
  isLoading?: boolean;
  onCheckout: () => void;
  onLogin?: () => void;
  isAuthenticated?: boolean;
}

function formatPrice(cents: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

export function PaywallContent({
  paywall,
  isLoading,
  onCheckout,
  onLogin,
  isAuthenticated = false,
}: PaywallContentProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!paywall?.variant) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Kein Angebot verfügbar.
      </div>
    );
  }

  const { variant, actual_price_cents } = paywall;
  const price = actual_price_cents ?? variant.price_cents;
  const features: string[] = Array.isArray(variant.features_json)
    ? variant.features_json
    : [];

  const isUrgency = variant.layout === 'urgency';
  const isValueHeavy = variant.layout === 'value_heavy';

  return (
    <div className="flex flex-col">
      {/* Hero header */}
      <div className={`px-6 pt-6 pb-4 ${isUrgency ? 'bg-destructive/5' : 'bg-primary/5'}`}>
        <div className="flex items-center gap-2 mb-3">
          {isUrgency ? (
            <Badge variant="destructive" className="gap-1">
              <Clock className="h-3 w-3" />
              Prüfung rückt näher
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1">
              <Lock className="h-3 w-3" />
              Premium
            </Badge>
          )}
          {isValueHeavy && (
            <Badge variant="outline" className="gap-1 border-accent text-accent">
              <Sparkles className="h-3 w-3" />
              Beliebteste Wahl
            </Badge>
          )}
        </div>

        <h2 className="text-xl font-bold text-foreground leading-tight">
          {variant.headline ?? 'Premium freischalten'}
        </h2>
        {variant.subheadline && (
          <p className="text-sm text-muted-foreground mt-1">
            {variant.subheadline}
          </p>
        )}
      </div>

      {/* Features */}
      <div className="px-6 py-4 space-y-2.5">
        {features.map((feature, i) => (
          <div key={i} className="flex items-start gap-2.5 text-sm">
            <CheckCircle className="h-4 w-4 text-accent flex-shrink-0 mt-0.5" />
            <span className="text-foreground">{feature}</span>
          </div>
        ))}
      </div>

      {/* Price + CTA */}
      <div className="px-6 pb-6 pt-2 border-t border-border mt-2">
        <div className="flex items-baseline gap-2 mb-4">
          <span className="text-3xl font-bold text-foreground">
            {formatPrice(price, variant.currency)}
          </span>
          <span className="text-sm text-muted-foreground">
            einmalig · 12 Monate Zugang
          </span>
        </div>

        {isAuthenticated ? (
          <Button
            onClick={onCheckout}
            className="w-full h-12 text-base gradient-primary text-primary-foreground shadow-glow"
          >
            <ShoppingCart className="h-4 w-4 mr-2" />
            {variant.cta_text}
          </Button>
        ) : (
          <div className="space-y-2">
            <Button
              onClick={onLogin}
              className="w-full h-12 text-base gradient-primary text-primary-foreground shadow-glow"
            >
              Anmelden & kaufen
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              Melde dich an oder erstelle ein Konto, um fortzufahren.
            </p>
          </div>
        )}

        <p className="text-[10px] text-center text-muted-foreground mt-3">
          Einmalzahlung · Kein Abo · DSGVO-konform
        </p>
      </div>
    </div>
  );
}
