import { CheckCircle, Sparkles, Building2, ArrowRight, Mail } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { PricingPlan } from '@/hooks/usePricingPlans';

interface PricingPlanCardProps {
  plan: PricingPlan;
  onCheckout: (plan: PricingPlan) => void;
  onContactSales: (plan: PricingPlan) => void;
}

function formatPrice(cents: number | null, currency = 'EUR'): string {
  if (cents === null || cents === 0) return 'Auf Anfrage';
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function pricePerSeat(cents: number | null, seats: number | null): string | null {
  if (!cents || !seats || seats <= 1) return null;
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(cents / 100 / seats);
}

export function PricingPlanCard({ plan, onCheckout, onContactSales }: PricingPlanCardProps) {
  const features: string[] = Array.isArray(plan.features_json) ? plan.features_json : [];
  const perSeat = pricePerSeat(plan.price_cents, plan.seat_count);
  const isSales = plan.checkout_mode === 'sales';

  return (
    <Card className={`relative flex flex-col ${plan.is_featured ? 'border-primary shadow-lg ring-2 ring-primary/20' : 'border-border'}`}>
      {plan.is_featured && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="gap-1 bg-primary text-primary-foreground px-3">
            <Sparkles className="h-3 w-3" />
            Beliebteste Wahl
          </Badge>
        </div>
      )}

      <CardHeader className="pb-3 pt-6">
        <div className="flex items-center gap-2 mb-1">
          {isSales ? (
            <Building2 className="h-5 w-5 text-muted-foreground" />
          ) : null}
          <CardTitle className="text-xl">{plan.title}</CardTitle>
        </div>
        {plan.subtitle && (
          <CardDescription>{plan.subtitle}</CardDescription>
        )}
      </CardHeader>

      <CardContent className="flex-1 space-y-4">
        {/* Price */}
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-bold text-foreground">
              {formatPrice(plan.price_cents, plan.currency)}
            </span>
            {!isSales && plan.seat_count && (
              <span className="text-sm text-muted-foreground">
                / {plan.seat_count} {plan.seat_count === 1 ? 'Lizenz' : 'Lizenzen'}
              </span>
            )}
          </div>
          {perSeat && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {perSeat} pro Seat
            </p>
          )}
          {!isSales && (
            <p className="text-xs text-muted-foreground mt-1">
              Einmalzahlung · {plan.duration_days} Tage Zugang
            </p>
          )}
        </div>

        {/* Features */}
        <div className="space-y-2">
          {features.map((feature, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <CheckCircle className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
              <span className="text-foreground">{feature}</span>
            </div>
          ))}
        </div>
      </CardContent>

      <CardFooter className="pt-4">
        {isSales ? (
          <Button
            variant="outline"
            className="w-full h-11 gap-2"
            onClick={() => onContactSales(plan)}
          >
            <Mail className="h-4 w-4" />
            Demo anfragen
          </Button>
        ) : (
          <Button
            className={`w-full h-11 gap-2 ${plan.is_featured ? 'bg-primary text-primary-foreground shadow-glow' : ''}`}
            onClick={() => onCheckout(plan)}
          >
            Jetzt kaufen
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
