import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRight,
  BadgeEuro,
  BarChart3,
  Briefcase,
  Building2,
  CheckCircle2,
  GraduationCap,
  Loader2,
  ShieldAlert,
  Sparkles,
  Star,
  Target,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTrackGrowthEvent } from '@/hooks/useTrackGrowthEvent';
import { useExperimentVariant } from '@/hooks/useExperimentVariant';
import { toast } from 'sonner';

/* ------------------------------------------------------------------ */
/*  Static content                                                     */
/* ------------------------------------------------------------------ */

const failureCosts = [
  {
    title: 'IHK nicht bestanden',
    consequence: '+6 Monate Ausbildung oder erneute intensive Vorbereitung',
  },
  {
    title: 'Klausur nicht bestanden',
    consequence: 'Prüfungsversuch verloren, mehr Zeitdruck und mehr Unsicherheit',
  },
  {
    title: 'Betrieb / duales Studium',
    consequence: 'Betreuungsaufwand, Verzögerung und messbarer Produktivitätsverlust',
  },
  {
    title: 'Psychologischer Effekt',
    consequence: 'Stress, Motivationsverlust und sinkendes Selbstvertrauen vor der nächsten Prüfung',
  },
];

const compareRows: [string, string][] = [
  ['Du lernst „alles"', 'Du trainierst das, was geprüft wird'],
  ['Unsicherheit vor der Prüfung', 'Messbare Prüfungsreife'],
  ['Überraschungen in der Klausur', 'Prüfungsnahe Aufgaben und Simulationen'],
  ['Zeitverlust durch falschen Fokus', 'Gezieltes Training deiner Schwächen'],
];

/* ------------------------------------------------------------------ */
/*  DB plan type                                                       */
/* ------------------------------------------------------------------ */

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

function isStudiumPlan(plan: PricingPlan): boolean {
  return (plan.metadata_json as any)?.track === 'STUDIUM';
}

function formatPrice(cents: number | null): string {
  if (!cents) return 'Auf Anfrage';
  return `${(cents / 100).toFixed(0)} €`;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function SectionTitle({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text?: string;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary">
        {eyebrow}
      </p>
      <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        {title}
      </h2>
      {text && (
        <p className="mt-4 text-base leading-7 text-muted-foreground sm:text-lg">{text}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Plan card (DB-driven)                                              */
/* ------------------------------------------------------------------ */

function PlanCard({
  plan,
  loading,
  onCheckout,
  badge,
  oldPrice,
  description,
  icon: Icon,
  highlighted,
  secondary,
}: {
  plan: PricingPlan;
  loading: boolean;
  onCheckout: () => void;
  badge?: string;
  oldPrice?: string | null;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  highlighted?: boolean;
  secondary?: string | null;
}) {
  const features = Array.isArray(plan.features_json) ? plan.features_json : [];
  const isSales = plan.checkout_mode === 'sales';

  return (
    <Card
      className={`relative rounded-[2rem] border shadow-sm ${
        highlighted
          ? 'border-primary/30 bg-primary/5 shadow-lg'
          : 'border-border bg-card'
      }`}
    >
      <CardContent className="p-7">
        {badge && (
          <div className="mb-4 inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
            {badge}
          </div>
        )}

        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-bold text-foreground">{plan.title}</h3>
            {plan.subtitle && (
              <p className="mt-2 text-sm text-muted-foreground">{plan.subtitle}</p>
            )}
          </div>
          <div className="rounded-2xl bg-background p-3 text-primary shadow-sm">
            <Icon className="h-5 w-5" />
          </div>
        </div>

        <div className="mb-5">
          {oldPrice && (
            <p className="text-sm text-muted-foreground line-through">{oldPrice}</p>
          )}
          <div className="flex items-end gap-2">
            <span className="text-4xl font-extrabold tracking-tight text-foreground">
              {formatPrice(plan.price_cents)}
            </span>
            {!isSales && plan.price_cents && (
              <span className="pb-1 text-sm text-muted-foreground">einmalig</span>
            )}
          </div>
          {plan.seat_count && plan.seat_count > 1 && plan.price_cents && (
            <p className="mt-1 text-xs text-muted-foreground">
              {(plan.price_cents / 100 / plan.seat_count).toFixed(0)} € / Seat
            </p>
          )}
        </div>

        {description && (
          <p className="mb-6 text-sm leading-6 text-muted-foreground">{description}</p>
        )}

        <div className="space-y-3">
          {features.map((f) => (
            <div key={f} className="flex items-start gap-2 text-sm text-foreground">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{f}</span>
            </div>
          ))}
        </div>

        <div className="mt-7 flex flex-col gap-3">
          <Button
            onClick={onCheckout}
            disabled={loading}
            className={`h-11 rounded-2xl px-5 text-sm font-semibold ${
              highlighted ? 'gradient-primary text-primary-foreground shadow-glow' : ''
            }`}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isSales ? (
              <>
                Demo anfragen
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            ) : (
              <>
                Jetzt starten
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
          {secondary && (
            <Button
              variant="outline"
              className="h-11 rounded-2xl px-5 text-sm font-semibold"
              asChild
            >
              <Link to="/pruefungsreife-check">{secondary}</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Icon + badge + description mapping per plan_key                    */
/* ------------------------------------------------------------------ */

const planMeta: Record<
  string,
  {
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
    oldPrice?: string;
    description?: string;
    highlighted?: boolean;
    secondary?: string;
  }
> = {
  // B2C
  studium_single: {
    icon: GraduationCap,
    badge: 'Early Access',
    oldPrice: '79 €',
    description:
      'Für Studierende, die nicht nur lernen, sondern ihre Modulprüfung planbar bestehen wollen.',
    highlighted: true,
    secondary: 'Kostenlos testen',
  },
  azubi_single: {
    icon: Sparkles,
    badge: 'Beliebt',
    description:
      'Für Auszubildende, die ihre Abschlussprüfung sicherer, strukturierter und prüfungsnah vorbereiten wollen.',
  },
  // B2B fallbacks
  team_5: { icon: Users },
  team_10: { icon: Building2 },
  business_10: { icon: Building2 },
  business_25: { icon: BarChart3 },
  enterprise: { icon: BarChart3 },
};

function getMetaForPlan(plan: PricingPlan) {
  const meta = planMeta[plan.plan_key];
  return {
    icon: meta?.icon ?? (plan.audience_type === 'b2b' ? Building2 : Sparkles),
    badge: meta?.badge,
    oldPrice: meta?.oldPrice,
    description: meta?.description ?? plan.description ?? undefined,
    highlighted: meta?.highlighted ?? plan.is_featured,
    secondary: meta?.secondary,
  };
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function PricingSectionHighConvert() {
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

  const b2cStudy = (plans ?? []).filter(
    (p) => p.audience_type === 'b2c' && isStudiumPlan(p)
  );
  const b2cVocational = (plans ?? []).filter(
    (p) => p.audience_type === 'b2c' && !isStudiumPlan(p)
  );
  const b2bPlans = (plans ?? []).filter((p) => p.audience_type === 'b2b');

  async function handleCheckout(plan: PricingPlan) {
    if (!user) {
      toast.info('Bitte melde dich an, um fortzufahren.');
      navigate('/auth?redirect=/preise');
      return;
    }

    const trackLabel = isStudiumPlan(plan) ? 'studium' : 'ausbildung';
    const audienceLabel = plan.audience_type === 'b2b' ? 'b2b' : 'b2c';

    if (plan.checkout_mode === 'sales') {
      trackEvent('cta_click', {
        plan_key: plan.plan_key,
        granular_event: 'pricing_contact_enterprise',
        track: trackLabel,
      });
      toast.info('Für Enterprise-Anfragen kontaktiere uns bitte.');
      return;
    }

    if (!plan.stripe_price_id) {
      toast.error('Dieser Plan ist noch nicht kaufbar.');
      return;
    }

    setCheckoutLoading(plan.id);
    trackEvent('cta_click', {
      plan_key: plan.plan_key,
      price_cents: plan.price_cents,
      granular_event: `pricing_buy_${trackLabel}_${audienceLabel}`,
      audience_type: plan.audience_type,
      track: trackLabel,
    });

    try {
      const { data, error } = await supabase.functions.invoke('create-payment', {
        body: {
          product_id: plan.product_id,
          pricing_plan_id: plan.id,
        },
      });
      if (error) throw error;
      if (data?.checkout_url) {
        window.location.href = data.checkout_url;
      }
    } catch {
      toast.error('Fehler beim Erstellen der Checkout-Session.');
    } finally {
      setCheckoutLoading(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="bg-background text-foreground">
      {/* ── Hero: Risk framing ── */}
      <section className="border-b border-border bg-gradient-to-b from-background via-background to-muted/30">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:py-24">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
          >
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
              <BadgeEuro className="h-4 w-4" />
              Preisstrategie mit Ergebnisfokus
            </div>
            <h1 className="max-w-3xl text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
              Bestehe deine Prüfung.{' '}
              <span className="text-gradient">Oder zahle den Preis dafür.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
              Ein nicht bestandener Versuch kostet Zeit, Nerven, Versuche — und im Betrieb
              oft deutlich mehr Geld als ein gutes Prüfungstraining. ExamFit kostet dich
              einmalig weniger als falsches Lernen über Wochen.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button
                size="lg"
                className="h-12 rounded-2xl px-6 text-base font-semibold gradient-primary text-primary-foreground shadow-glow"
                onClick={() =>
                  document.getElementById('pricing-plans')?.scrollIntoView({ behavior: 'smooth' })
                }
              >
                Jetzt passende Option wählen
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 rounded-2xl px-6 text-base font-semibold"
                asChild
              >
                <Link to="/pruefungsreife-check">Prüfungsreife kostenlos testen</Link>
              </Button>
            </div>
          </motion.div>

          {/* Failure cost card */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08 }}
          >
            <Card className="rounded-[2rem] border-destructive/20 bg-destructive/5 shadow-sm">
              <CardContent className="p-6 sm:p-7">
                <div className="mb-5 flex items-center gap-3">
                  <div className="rounded-2xl bg-destructive/10 p-3 text-destructive">
                    <ShieldAlert className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-wide text-destructive">
                      Kosten des Scheiterns
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Das eigentliche Preisargument liegt nicht im Produkt, sondern im Risiko.
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  {failureCosts.map((item) => (
                    <div
                      key={item.title}
                      className="rounded-2xl border border-border bg-background/80 p-4"
                    >
                      <p className="font-semibold text-foreground">{item.title}</p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {item.consequence}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-6 rounded-2xl bg-foreground px-5 py-4 text-background">
                  <p className="text-sm font-semibold uppercase tracking-wide">
                    Realistische Spannweite
                  </p>
                  <p className="mt-2 text-2xl font-bold">1.000 € – 15.000 €</p>
                  <p className="mt-1 text-sm text-background/80">
                    Ein Durchfallversuch kostet oft ein Vielfaches des Trainingspreises.
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </section>

      {/* ── B2C Plans ── */}
      <section id="pricing-plans" className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
        <SectionTitle
          eyebrow="Einzelzugang"
          title="Weniger Risiko. Mehr Prüfungsreife."
          text="Nicht Content kaufen — sondern Orientierung, Prüfungssicherheit und gezieltes Training dort, wo es zählt."
        />

        <div className="mt-12 grid gap-6 lg:grid-cols-2 max-w-4xl mx-auto">
          {b2cStudy.map((plan) => {
            const meta = getMetaForPlan(plan);
            return (
              <PlanCard
                key={plan.id}
                plan={plan}
                loading={checkoutLoading === plan.id}
                onCheckout={() => handleCheckout(plan)}
                {...meta}
              />
            );
          })}
          {b2cVocational.map((plan) => {
            const meta = getMetaForPlan(plan);
            return (
              <PlanCard
                key={plan.id}
                plan={plan}
                loading={checkoutLoading === plan.id}
                onCheckout={() => handleCheckout(plan)}
                {...meta}
              />
            );
          })}
        </div>
      </section>

      {/* ── B2B Plans ── */}
      <section className="bg-muted/40 py-16">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <SectionTitle
            eyebrow="Für Teams & Institutionen"
            title="Betriebe, duales Studium und Hochschulen"
            text="Der wirtschaftliche Hebel liegt dort, wo mehrere Lernende begleitet werden und Prüfungsrisiken früh sichtbar werden müssen."
          />

          <div className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-3 max-w-5xl mx-auto">
            {b2bPlans.map((plan) => {
              const meta = getMetaForPlan(plan);
              return (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  loading={checkoutLoading === plan.id}
                  onCheckout={() => handleCheckout(plan)}
                  {...meta}
                />
              );
            })}
          </div>

          <p className="mt-8 text-center text-sm text-muted-foreground">
            👉 Ein Durchfaller kostet mehr als alle Lizenzen zusammen.
          </p>
        </div>
      </section>

      {/* ── Comparison table ── */}
      <section className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
        <SectionTitle
          eyebrow="Vergleich"
          title="Ohne ExamFit vs. mit ExamFit"
          text="Der Unterschied ist nicht, ob gelernt wird. Der Unterschied ist, ob prüfungsrelevant trainiert wird."
        />

        <div className="mt-12 overflow-hidden rounded-[2rem] border border-border bg-card shadow-sm max-w-4xl mx-auto">
          <div className="grid grid-cols-2 border-b border-border bg-muted/30">
            <div className="px-4 py-3 sm:px-6 sm:py-4 text-sm font-semibold text-muted-foreground">
              Ohne System
            </div>
            <div className="px-4 py-3 sm:px-6 sm:py-4 text-sm font-semibold text-primary">
              Mit ExamFit
            </div>
          </div>
          {compareRows.map(([left, right]) => (
            <div key={left} className="grid grid-cols-2 border-b border-border last:border-b-0">
              <div className="px-4 py-3 sm:px-6 sm:py-4 text-sm leading-6 text-muted-foreground">
                {left}
              </div>
              <div className="px-4 py-3 sm:px-6 sm:py-4 text-sm font-medium leading-6 text-foreground">
                {right}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="border-t border-border bg-foreground text-background">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8 lg:py-20">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">
              Finaler Preisanker
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Die Frage ist nicht: „Ist das teuer?"
            </h2>
            <p className="mt-4 text-lg leading-8 text-background/80">
              Die bessere Frage ist: Was kostet es dich oder deine Organisation, wenn ihr
              ohne klares Prüfungssystem weitermacht?
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button
                size="lg"
                className="h-12 rounded-2xl px-6 text-base font-semibold"
                onClick={() =>
                  document.getElementById('pricing-plans')?.scrollIntoView({ behavior: 'smooth' })
                }
              >
                Jetzt Prüfungstraining wählen
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 rounded-2xl border-background/20 bg-transparent px-6 text-base font-semibold text-background hover:bg-background/10 hover:text-background"
                asChild
              >
                <Link to="/kontakt">Demo oder Beratung anfragen</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
