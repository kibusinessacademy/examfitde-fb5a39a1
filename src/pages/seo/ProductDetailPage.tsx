import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { useSingleBeruf, useCurriculumProductBySlug } from '@/hooks/useSEOPages';
import { SEO_TEMPLATES, SITE_URL, PRODUCT_PRICES, generateProductSchema } from '@/lib/seo';
import { PRICING } from '@/config/pricing';
import { trackConversion } from '@/lib/seo-tracking';
import { trackFunnel } from '@/lib/conversionTracking';
import { useResolvePackageContext } from '@/hooks/useResolvePackageContext';
import { startProductCheckout } from '@/lib/checkout/startProductCheckout';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { BundleHero } from '@/components/landing/bundle/BundleHero';
import { BundleModulesBlock } from '@/components/landing/bundle/BundleModulesBlock';
import { BundleComparisonBlock } from '@/components/landing/bundle/BundleComparisonBlock';
import { BundleOutcomesBlock } from '@/components/landing/bundle/BundleOutcomesBlock';
import { BundleStickyCta } from '@/components/landing/bundle/BundleStickyCta';

/**
 * BundleDetailPage (Phase B) — Bundle als Prüfungssystem positioniert.
 * Tracking: bestehende SSOT-Events (cta_click, product_view, checkout_start).
 * Kein neuer Event-Type, kein Backend-Touch, keine Logik-Duplizierung.
 */
function BundleDetailPageComponent() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const beruf = useSingleBeruf(slug || '');
  const product = useCurriculumProductBySlug(slug || '', 'bundle');

  const heroRef = useRef<HTMLDivElement>(null);
  const [showStickyCta, setShowStickyCta] = useState(false);

  const { data: pkgCtx } = useResolvePackageContext({
    curriculumId: product?.curriculum_id ?? null,
  });

  // pricing_view-Äquivalent (existiert nicht im Enum) → product_view, sobald Page geladen
  useEffect(() => {
    if (!beruf) return;
    trackConversion({ event: 'product_view', source: 'bundle_page', label: slug });
  }, [beruf, slug]);

  // SSOT pricing_view → conversion_events sobald package_id resolved (funnel-loss-Pflicht).
  useEffect(() => {
    if (!beruf || !pkgCtx?.package_id) return;
    trackFunnel('pricing_view', {
      package_id: pkgCtx.package_id,
      curriculum_id: pkgCtx.curriculum_id,
      persona: pkgCtx.persona,
      source_page: `/paket/${slug}`,
      metadata: { bundle_slug: slug, beruf: beruf.title },
    });
  }, [product?.curriculum_id, pkgCtx?.package_id, slug]);

  // Sticky-CTA: zeigen, wenn Hero aus dem Viewport ist
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setShowStickyCta(!entry.isIntersecting),
      { threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [beruf]);

  const handleCheckoutStart = useCallback(async (source: string) => {
    trackConversion({ event: 'cta_click', source, label: 'bundle_checkout_start' });
    trackConversion({ event: 'checkout_start', source, label: slug });
    const sourcePage = `/bundle/${slug}`;
    trackFunnel('cta_clicked', {
      package_id: pkgCtx?.package_id ?? null,
      curriculum_id: pkgCtx?.curriculum_id ?? null,
      persona: pkgCtx?.persona ?? null,
      source_page: sourcePage,
      metadata: { source, bundle_slug: slug },
    });
    trackFunnel('checkout_start', {
      package_id: pkgCtx?.package_id ?? null,
      curriculum_id: pkgCtx?.curriculum_id ?? null,
      persona: pkgCtx?.persona ?? null,
      source_page: sourcePage,
      metadata: { source, bundle_slug: slug },
    });

    const productSlug = product?.slug || slug;
    if (!productSlug) {
      toast({
        title: 'Checkout nicht verfügbar',
        description: 'Dieses Komplettpaket ist aktuell nicht buchbar. Bitte später erneut versuchen.',
        variant: 'destructive',
      });
      return;
    }

    const result = await startProductCheckout(productSlug, { source: `bundle_${source}` });

    // ── Strukturierter Fehlerpfad: Product not found / ambiguous ──
    // Statt rohem "non-2xx" → freundliche Meldung + Redirect auf Vorschlag
    // oder Kurs-Übersicht. Der Funnel bricht nicht ab, der Nutzer landet
    // auf einer kaufbaren Seite.
    if (result.error_code === "product_not_found") {
      const target = result.suggested_url || result.fallback_url || "/berufe";
      toast({
        title: "Komplettpaket nicht gefunden",
        description: result.suggested_slug
          ? "Wir leiten dich auf das passende Paket weiter."
          : "Wir leiten dich zur Kursübersicht weiter, dort findest du das richtige Paket.",
      });
      void supabase.rpc("fn_emit_audit", {
        _action_type: "checkout_product_not_found_redirect",
        _target_type: "checkout",
        _target_id: productSlug,
        _result_status: "redirected",
        _payload: {
          product_slug: productSlug,
          suggested_slug: result.suggested_slug ?? null,
          target_url: target,
          source: `bundle_${source}`,
        },
        _trigger_source: "bundle_cta",
      } as never);
      navigate(target);
      return;
    }

    if (result.error_code === "slug_ambiguous") {
      const target = result.candidates?.[0]?.url ?? "/berufe";
      toast({
        title: "Bitte Paket erneut wählen",
        description: "Mehrere Pakete passen zu diesem Link. Wir leiten dich zur Auswahl weiter.",
      });
      navigate(target);
      return;
    }

    if (!result.ok || !result.checkout_url) {
      // Hard-fail toast + Audit (kein navigate('/shop')-Fallback mehr)
      toast({
        title: 'Checkout fehlgeschlagen',
        description: result.error || 'Konnte Stripe-Checkout nicht starten. Bitte erneut versuchen.',
        variant: 'destructive',
      });
      // Audit via SSOT fn_emit_audit (silent-drop-frei)
      void supabase.rpc('fn_emit_audit', {
        _action_type: 'checkout_redirect_missing_url',
        _target_type: 'checkout',
        _target_id: productSlug,
        _result_status: 'error',
        _payload: { product_slug: productSlug, source: `bundle_${source}`, error: result.error ?? null },
        _trigger_source: 'bundle_cta',
        _error_message: result.error ?? 'missing checkout_url',
      } as never);
    }
    // bei Erfolg führt startProductCheckout selbst den Stripe-Redirect aus
  }, [slug, pkgCtx, product?.slug, navigate]);

  // Post-Login Auto-Resume: ?intent=checkout (gesetzt vom Auth-Gate in startProductCheckout)
  // triggert nach erfolgreichem Login automatisch den Stripe-Checkout. One-shot via Strip-Param.
  const { user, loading: authLoading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const autoResumeFiredRef = useRef(false);
  useEffect(() => {
    if (autoResumeFiredRef.current) return;
    if (authLoading) return;
    if (!user) return;
    if (searchParams.get('intent') !== 'checkout') return;
    if (!product?.slug && !slug) return;
    autoResumeFiredRef.current = true;
    // intent aus URL entfernen, BEVOR der Redirect läuft (Back-Button-Safe)
    const next = new URLSearchParams(searchParams);
    next.delete('intent');
    setSearchParams(next, { replace: true });
    void handleCheckoutStart('post_login_resume');
  }, [user, authLoading, searchParams, setSearchParams, product?.slug, slug, handleCheckoutStart]);


  const seo = useMemo(() => beruf ? SEO_TEMPLATES.bundle(beruf.title) : null, [beruf]);
  const price = PRODUCT_PRICES.bundle;
  const priceDisplay = PRICING.defaultPrice;

  const structuredData = useMemo(() => {
    if (!beruf || !seo) return undefined;
    return generateProductSchema({
      name: `${beruf.title} Komplettpaket`,
      description: seo.description,
      price,
      url: `${SITE_URL}/paket/${slug}`,
      sku: `bundle-${slug}`,
      ratingValue: 4.9,
      reviewCount: 127,
    });
  }, [beruf, seo, price, slug]);

  if (!beruf) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <h1 className="text-2xl font-bold mb-4">Komplettpaket nicht gefunden</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Dieses Komplettpaket ist nicht verfügbar. Sieh dir alle Berufe an oder gehe zurück zur Startseite.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <Button asChild><Link to="/berufe">Alle Berufe anzeigen</Link></Button>
            <Button asChild variant="outline"><Link to="/">Zur Startseite</Link></Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <SEOHead
        title={product?.seo_title || seo!.title}
        description={product?.seo_description || seo!.description}
        canonical={`${SITE_URL}/paket/${slug}`}
        type="product"
        structuredData={structuredData}
      />

      <main className="min-h-screen pb-24 md:pb-0">
        <div className="container max-w-5xl pt-4">
          <Breadcrumbs
            items={[
              { label: 'Komplettpakete', href: '/paket' },
              { label: beruf.title },
            ]}
          />
        </div>

        <div ref={heroRef}>
          <BundleHero
            beruf={beruf.title}
            priceDisplay={priceDisplay}
            onCtaClick={() => handleCheckoutStart('bundle_hero')}
          />
        </div>

        <BundleModulesBlock />
        <BundleComparisonBlock />
        <BundleOutcomesBlock />

        {/* Final-CTA */}
        <section className="py-16 md:py-20 bg-gradient-to-br from-primary/10 via-transparent to-accent/10">
          <div className="container max-w-2xl text-center">
            <h2 className="text-2xl md:text-4xl font-display font-bold mb-3 text-text-primary">
              Bereit für die Abschlussprüfung?
            </h2>
            <p className="text-base md:text-lg text-text-secondary mb-7">
              Starte dein Prüfungssystem für {beruf.title}. Einmalzahlung, 12 Monate Zugang,
              sofort einsatzbereit.
            </p>
            <Button
              size="lg"
              className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-10 text-lg"
              onClick={() => handleCheckoutStart('bundle_final')}
              data-cta-location="bundle_final_cta"
            >
              Komplettpaket starten – {priceDisplay}
            </Button>
            <p className="mt-4 text-xs text-text-secondary">
              Kein Abo · 12 Monate Zugang · Sofort starten
            </p>
          </div>
        </section>
      </main>

      <BundleStickyCta
        priceDisplay={priceDisplay}
        visible={showStickyCta}
        onCtaClick={() => handleCheckoutStart('bundle_sticky')}
      />
    </>
  );
}

export function BundleDetailPage() {
  return <BundleDetailPageComponent />;
}

export default BundleDetailPageComponent;
