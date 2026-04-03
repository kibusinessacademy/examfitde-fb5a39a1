import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTrackGrowthEvent } from '@/hooks/useTrackGrowthEvent';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowRight,
  Check,
  GraduationCap,
  Briefcase,
  Building2,
  Loader2,
  Star,
  Shield,
  Clock,
  CreditCard,
} from 'lucide-react';
import { toast } from 'sonner';

type PricingPlan = {
  id: string;
  plan_key: string;
  audience_type: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  seat_count: number | null;
  price_cents: number | null;
  duration_days: number;
  checkout_mode: string;
  stripe_price_id: string | null;
  sort_order: number;
  is_active: boolean;
  is_featured: boolean;
  features_json: string[];
  metadata_json: Record<string, unknown>;
  product_id: string;
};

type Track = 'ausbildung' | 'studium';

function isStudiumPlan(plan: PricingPlan): boolean {
  return (plan.metadata_json as any)?.track === 'STUDIUM';
}

function formatPrice(cents: number | null): string {
  if (!cents) return 'Auf Anfrage';
  return `${(cents / 100).toFixed(0)}`;
}

function pricePerSeat(plan: PricingPlan): string | null {
  if (!plan.price_cents || !plan.seat_count || plan.seat_count <= 1) return null;
  return `${(plan.price_cents / 100 / plan.seat_count).toFixed(0)} € / Seat`;
}

export function PricingCards({ defaultTrack = 'ausbildung' }: { defaultTrack?: Track }) {
  const [track, setTrack] = useState<Track>(defaultTrack);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const { user } = useAuth();
  const { track: trackEvent } = useTrackGrowthEvent();
  const navigate = useNavigate();

  const { data: plans, isLoading } = useQuery({
    queryKey: ['pricing-plans-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pricing_plans')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return (data as unknown as PricingPlan[]) ?? [];
    },
  });

  const b2cPlans = (plans ?? []).filter(
    (p) =>
      p.audience_type === 'b2c' &&
      (track === 'studium' ? isStudiumPlan(p) : !isStudiumPlan(p))
  );

  const b2bPlans = (plans ?? []).filter(
    (p) =>
      p.audience_type === 'b2b' &&
      (track === 'studium' ? isStudiumPlan(p) : !isStudiumPlan(p))
  );

  async function handleCheckout(plan: PricingPlan) {
    if (!user) {
      toast.info('Bitte melde dich an, um fortzufahren.');
      navigate('/auth?redirect=/preise');
      return;
    }

    if (plan.checkout_mode === 'sales') {
      toast.info('Für Enterprise-Anfragen kontaktiere uns bitte.');
      return;
    }

    if (!plan.stripe_price_id) {
      toast.error('Dieser Plan ist noch nicht kaufbar.');
      return;
    }

    setCheckoutLoading(plan.id);
    trackEvent('cta_click', { plan_key: plan.plan_key, price_cents: plan.price_cents });

    try {
      const { data, error } = await supabase.functions.invoke('create-payment', {
        body: {
          product_id: plan.product_id,
          pricing_plan_id: plan.id,
        },
      });

      if (error) throw error;
      if (data?.checkout_url) {
        window.open(data.checkout_url, '_blank');
      }
    } catch (err) {
      toast.error('Fehler beim Erstellen der Checkout-Session.');
      console.error(err);
    } finally {
      setCheckoutLoading(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-12">
      {/* Track Switcher */}
      <div className="flex justify-center">
        <div className="inline-flex rounded-2xl border border-border bg-muted/50 p-1">
          <button
            onClick={() => setTrack('ausbildung')}
            className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-all ${
              track === 'ausbildung'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Briefcase className="h-4 w-4" />
            Ausbildung
          </button>
          <button
            onClick={() => setTrack('studium')}
            className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-all ${
              track === 'studium'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <GraduationCap className="h-4 w-4" />
            Studium
          </button>
        </div>
      </div>

      {/* B2C Section */}
      <section>
        <h2 className="text-2xl font-display font-bold text-center mb-8">
          Für {track === 'studium' ? 'Studierende' : 'Auszubildende'}
        </h2>
        <div className="grid md:grid-cols-1 gap-6 max-w-lg mx-auto">
          {b2cPlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              loading={checkoutLoading === plan.id}
              onCheckout={() => handleCheckout(plan)}
            />
          ))}
        </div>
      </section>

      {/* B2B Section */}
      <section>
        <div className="text-center mb-8">
          <Badge variant="outline" className="mb-3">
            <Building2 className="h-3 w-3 mr-1" />
            Für {track === 'studium' ? 'Hochschulen & Betriebe' : 'Ausbildungsbetriebe'}
          </Badge>
          <h2 className="text-2xl font-display font-bold">
            {track === 'studium'
              ? 'Klausurtraining für Teams & Institutionen'
              : 'Prüfungstraining für mehrere Azubis'}
          </h2>
        </div>
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6 max-w-6xl mx-auto">
          {b2bPlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              loading={checkoutLoading === plan.id}
              onCheckout={() => handleCheckout(plan)}
              compact
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function PlanCard({
  plan,
  loading,
  onCheckout,
  compact,
}: {
  plan: PricingPlan;
  loading: boolean;
  onCheckout: () => void;
  compact?: boolean;
}) {
  const perSeat = pricePerSeat(plan);
  const isSales = plan.checkout_mode === 'sales';
  const features = Array.isArray(plan.features_json) ? plan.features_json : [];

  return (
    <Card
      className={`relative rounded-3xl transition-all ${
        plan.is_featured ? 'ring-2 ring-primary shadow-lg' : 'shadow-sm'
      }`}
    >
      {plan.is_featured && (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
          <Star className="h-3 w-3 mr-1" />
          Beliebteste Wahl
        </Badge>
      )}
      <CardHeader className={compact ? 'pb-3' : ''}>
        <CardTitle className={compact ? 'text-lg' : 'text-xl'}>{plan.title}</CardTitle>
        {plan.subtitle && (
          <p className="text-sm text-muted-foreground">{plan.subtitle}</p>
        )}
      </CardHeader>
      <CardContent>
        {/* Price */}
        <div className="mb-4">
          {plan.price_cents ? (
            <>
              <span className={`font-display font-bold text-gradient ${compact ? 'text-3xl' : 'text-4xl'}`}>
                {formatPrice(plan.price_cents)} €
              </span>
              <span className="text-sm text-muted-foreground ml-2">einmalig</span>
              {perSeat && (
                <p className="text-xs text-muted-foreground mt-1">{perSeat}</p>
              )}
            </>
          ) : (
            <span className="text-2xl font-bold text-foreground">Auf Anfrage</span>
          )}
        </div>

        {/* Features */}
        <ul className={`space-y-2 ${compact ? 'mb-4' : 'mb-6'}`}>
          {features.map((f: string) => (
            <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
              <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <span>{f}</span>
            </li>
          ))}
        </ul>

        {/* CTA */}
        <Button
          onClick={onCheckout}
          disabled={loading}
          className={`w-full rounded-xl ${
            plan.is_featured
              ? 'gradient-primary text-primary-foreground shadow-glow'
              : ''
          }`}
          variant={plan.is_featured ? 'default' : isSales ? 'outline' : 'default'}
          size={compact ? 'default' : 'lg'}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isSales ? (
            <>
              Kontakt aufnehmen
              <ArrowRight className="h-4 w-4 ml-2" />
            </>
          ) : (
            <>
              Jetzt kaufen
              <ArrowRight className="h-4 w-4 ml-2" />
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
