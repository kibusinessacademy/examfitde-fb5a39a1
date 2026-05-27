import { useParams, Navigate, Link, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getVertical } from "@/data/verticals";
import { VERTICAL_TIERS, type VerticalTier } from "@/config/verticalPricing";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, ArrowLeft, Shield, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function VerticalDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const vertical = slug ? getVertical(slug) : undefined;
  const [loadingTier, setLoadingTier] = useState<VerticalTier | null>(null);

  if (!vertical) return <Navigate to="/branchen" replace />;

  const checkoutStatus = searchParams.get("checkout");

  const handleSubscribe = async (tier: VerticalTier) => {
    if (tier === "enterprise") {
      window.location.href = `mailto:sales@berufos.com?subject=BerufOS%20${encodeURIComponent(vertical.brand)}%20Enterprise%20Anfrage`;
      return;
    }
    setLoadingTier(tier);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        toast.error("Bitte zuerst einloggen, um zu abonnieren.");
        window.location.href = `/auth?redirect=${encodeURIComponent(`/branchen/${vertical.slug}`)}`;
        return;
      }
      const { data, error } = await supabase.functions.invoke("create-vertical-checkout", {
        body: { vertical_slug: vertical.slug, tier },
      });
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      } else {
        throw new Error("Keine Checkout-URL erhalten");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Checkout konnte nicht gestartet werden");
    } finally {
      setLoadingTier(null);
    }
  };

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>{`${vertical.brand} — ${vertical.tagline}`}</title>
        <meta name="description" content={vertical.metaDescription} />
        <link rel="canonical" href={`https://berufos.com/branchen/${vertical.slug}`} />
      </Helmet>

      <div className="container mx-auto px-4 py-6 max-w-6xl">
        <Link to="/branchen" className="inline-flex items-center gap-1 text-sm text-text-2 hover:text-text-1">
          <ArrowLeft className="h-4 w-4" /> Alle Branchen
        </Link>
      </div>

      {/* HERO */}
      <section className="border-b border-border bg-surface-1">
        <div className="container mx-auto px-4 py-12 md:py-20 max-w-5xl">
          <div className="text-5xl mb-4">{vertical.emoji}</div>
          <Badge variant="outline" className="mb-3">EU-gehostet · DSGVO · AI-Act-ready</Badge>
          <h1 className="text-3xl md:text-5xl font-bold text-text-1 mb-4">{vertical.brand}</h1>
          <p className="text-xl text-text-2 mb-4">{vertical.tagline}</p>
          <p className="text-text-3">{vertical.audience}</p>
        </div>
      </section>

      {checkoutStatus === "success" && (
        <div className="container mx-auto px-4 pt-6 max-w-5xl">
          <div className="rounded-lg border border-success/40 bg-status-bg-subtle p-4 text-sm text-text-1">
            Checkout abgeschlossen. Deine Subscription wird in den nächsten Minuten aktiviert.
          </div>
        </div>
      )}
      {checkoutStatus === "canceled" && (
        <div className="container mx-auto px-4 pt-6 max-w-5xl">
          <div className="rounded-lg border border-border bg-surface-2 p-4 text-sm text-text-2 inline-flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> Checkout abgebrochen — du kannst es jederzeit erneut starten.
          </div>
        </div>
      )}

      {/* PAIN POINTS */}
      <section className="container mx-auto px-4 py-12 max-w-5xl">
        <h2 className="text-2xl font-bold text-text-1 mb-2">Was {vertical.brand} dir abnimmt</h2>
        <p className="text-text-2 mb-6">Die typischen Belastungen deiner Branche — automatisiert oder vorbereitet.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {vertical.painPoints.map((p) => (
            <div key={p} className="flex items-start gap-3 rounded-lg border border-border bg-surface-1 p-4">
              <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <span className="text-text-1">{p}</span>
            </div>
          ))}
        </div>
      </section>

      {/* WORKFLOWS */}
      <section className="container mx-auto px-4 py-8 max-w-5xl">
        <h2 className="text-2xl font-bold text-text-1 mb-2">Beispielhafte Vorgänge</h2>
        <p className="text-text-2 mb-6">Jeder dieser Workflows zählt als ein "intelligenter Vorgang" gegen dein Monats-Limit.</p>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {vertical.exampleWorkflows.map((w) => (
            <li key={w} className="rounded-lg border border-border bg-surface-1 px-4 py-3 text-text-1">
              {w}
            </li>
          ))}
        </ul>
      </section>

      {/* PRICING */}
      <section id="pricing" className="border-t border-border bg-surface-1">
        <div className="container mx-auto px-4 py-12 max-w-5xl">
          <h2 className="text-2xl md:text-3xl font-bold text-text-1 mb-2">Pakete für {vertical.brand}</h2>
          <p className="text-text-2 mb-8">Klar kalkulierbar. Keine "unlimited AI". Limits transparent in Vorgängen pro Monat.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {VERTICAL_TIERS.map((t) => (
              <Card key={t.key} className={t.recommended ? "border-primary shadow-elev-2" : ""}>
                <CardHeader>
                  {t.recommended && <Badge className="mb-2 w-fit">Empfohlen</Badge>}
                  <CardTitle className="text-text-1">{t.label}</CardTitle>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-3xl font-bold text-text-1">{t.priceDisplay}</span>
                    <span className="text-text-3 text-sm">/ Monat</span>
                  </div>
                  <CardDescription className="text-text-2">
                    {t.monthlyVorgangLimit.toLocaleString("de-DE")} Vorgänge / Monat
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-text-2 mb-5">
                    {t.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full"
                    variant={t.recommended ? "default" : "outline"}
                    disabled={loadingTier === t.key}
                    onClick={() => handleSubscribe(t.key)}
                  >
                    {loadingTier === t.key ? "Wird vorbereitet …" : t.ctaLabel}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* EU TRUST */}
      <section className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="rounded-xl border border-border bg-surface-1 p-6">
          <div className="flex items-start gap-3">
            <Shield className="h-6 w-6 text-primary shrink-0 mt-1" />
            <div>
              <h3 className="text-lg font-bold text-text-1 mb-1">Souveräne europäische Branchenintelligenz</h3>
              <p className="text-sm text-text-2">
                EU-Hosting · EU-Datenhaltung · DSGVO by Default · AI-Act-ready by Design · Audit-Trail
                jeder Mutation · Human-in-the-Loop strukturell verankert (kein Auto-Apply).
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
