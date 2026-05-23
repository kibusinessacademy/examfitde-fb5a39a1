import { useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Loader2, ArrowRight, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProductPageSSOT } from '@/hooks/useProductPageSSOT';
import { useResolvePaywall } from '@/hooks/useResolvePaywall';
import { useHomepageCatalog } from '@/hooks/usePublishedCourses';
import { ProductPageTemplate } from '@/components/product/ProductPageTemplate';
import { trackEvent } from '@/lib/tracking/track';
import { trackFunnel } from '@/lib/conversionTracking';
import { findCatalogSlugCandidate } from '@/lib/slug-recovery';
import { getBerufUrl } from '@/lib/seo';

export default function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: product, isLoading, error } = useProductPageSSOT(slug);
  const { data: paywall } = useResolvePaywall({
    packageId: product?.packageId ?? null,
    triggerContext: 'product_page_view',
  });
  const trackedViewRef = useRef<string | null>(null);

  // Track product_view once per slug
  useEffect(() => {
    if (!product || trackedViewRef.current === product.canonicalSlug) return;
    trackedViewRef.current = product.canonicalSlug;
    trackEvent({
      eventName: 'product_view',
      productSlug: product.canonicalSlug,
      landingType: 'product_page',
    });
  }, [product]);

  // Scroll depth tracking
  useEffect(() => {
    if (!product) return;

    const thresholds = [25, 50, 75, 100];
    const fired = new Set<number>();

    const handleScroll = () => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll <= 0) return;
      const scrollPct = Math.round((window.scrollY / maxScroll) * 100);
      for (const t of thresholds) {
        if (scrollPct >= t && !fired.has(t)) {
          fired.add(t);
          trackEvent({
            eventName: 'product_scroll_depth',
            productSlug: product.canonicalSlug,
            metadata: { depth: t },
          });
        }
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [product]);

  // Pricing section visibility tracking — SSOT pricing_view in conversion_events
  // (zusätzlich zu legacy tracking_events, damit funnel-loss-detector greift).
  useEffect(() => {
    if (!product) return;
    const pricingEl = document.getElementById('pricing');
    if (!pricingEl) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          trackEvent({
            eventName: 'pricing_view',
            productSlug: product.canonicalSlug,
          });
          trackFunnel('pricing_view', {
            package_id: product.packageId ?? null,
            source_page: `/produkt/${product.canonicalSlug}`,
            metadata: { product_slug: product.canonicalSlug },
          });
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(pricingEl);
    return () => observer.disconnect();
  }, [product]);

  const handleCtaClick = useCallback(
    (ctaType: string) => {
      if (!product) return;
      trackEvent({
        eventName: 'product_cta_click',
        productSlug: product.canonicalSlug,
        metadata: { cta_type: ctaType },
      });
      // SSOT funnel events with package_id (Pflichtfeld für strict-events).
      const sourcePage = `/produkt/${product.canonicalSlug}`;
      trackFunnel('cta_clicked', {
        package_id: product.packageId ?? null,
        source_page: sourcePage,
        metadata: { cta_type: ctaType, product_slug: product.canonicalSlug },
      });
      trackFunnel('checkout_start', {
        package_id: product.packageId ?? null,
        source_page: sourcePage,
        metadata: { cta_type: ctaType, product_slug: product.canonicalSlug },
      });
      // Route to correct URL based on CTA type
      const url =
        ctaType === 'secondary' && product.ctas.secondaryUrl
          ? product.ctas.secondaryUrl
          : product.ctas.primaryUrl;
      navigate(url);
    },
    [product, navigate]
  );

  const handleFaqExpand = useCallback(
    (question: string) => {
      if (!product) return;
      trackEvent({
        eventName: 'faq_expand',
        productSlug: product.canonicalSlug,
        metadata: { question },
      });
    },
    [product]
  );

  const handleRelatedCourseClick = useCallback(
    (courseSlug: string) => {
      if (!product) return;
      trackEvent({
        eventName: 'related_course_click',
        productSlug: product.canonicalSlug,
        metadata: { target_slug: courseSlug },
      });
    },
    [product]
  );

  // Slug-Recovery: bei nicht aufgelöster SSOT-Page versuchen wir, einen passenden
  // Eintrag im veröffentlichten Katalog (saubere Berufs-Slugs) zu finden und auf
  // /berufe/<echter-slug> zu redirecten. Verhindert „Prüfungstraining nicht
  // gefunden" bei Karten/Links mit veralteten oder kurzen Slugs.
  const recoveryEnabled = !isLoading && (!!error || !product) && !!slug;
  const { data: catalog = [], isLoading: catalogLoading } = useHomepageCatalog();
  const recoveredSlug = useMemo(
    () => (recoveryEnabled ? findCatalogSlugCandidate(slug, catalog.map((c) => c.slug)) : null),
    [recoveryEnabled, slug, catalog],
  );
  const recoveryFiredRef = useRef(false);
  useEffect(() => {
    if (!recoveryEnabled || !recoveredSlug || recoveryFiredRef.current) return;
    recoveryFiredRef.current = true;
    trackEvent({
      eventName: 'course_resolver_recovered',
      productSlug: slug,
      metadata: { recovered_to: recoveredSlug, referrer: document.referrer || null },
    });
    navigate(getBerufUrl(recoveredSlug), { replace: true });
  }, [recoveryEnabled, recoveredSlug, slug, navigate]);

  if (isLoading || (recoveryEnabled && catalogLoading)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !product) {
    // Recovery in flight — show spinner instead of hard fail to avoid flash.
    if (recoveredSlug) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      );
    }

    // Soft fail: 3 verwandte Kurse + zwei Fallback-CTAs.
    if (slug) {
      trackEvent({
        eventName: 'course_resolver_failed',
        productSlug: slug,
        metadata: {
          referrer: typeof document !== 'undefined' ? document.referrer || null : null,
          pathname: typeof window !== 'undefined' ? window.location.pathname : null,
        },
      });
    }
    const related = catalog.slice(0, 3);

    return (
      <div className="container max-w-2xl py-16 px-4">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-display font-bold">Prüfungstraining nicht gefunden</h1>
          <p className="text-muted-foreground">
            Das gewünschte Prüfungstraining konnte nicht geladen werden. Vielleicht hilft dir einer
            dieser Berufe weiter:
          </p>
        </div>

        {related.length > 0 && (
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {related.map((c) => (
              <Link
                key={c.slug}
                to={getBerufUrl(c.slug)}
                className="rounded-xl border border-border bg-card p-4 hover:border-primary/40 transition-colors"
              >
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {c.categoryLabel}
                </p>
                <p className="mt-1 font-semibold text-sm text-foreground line-clamp-2">
                  {c.berufDisplayName || c.title}
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm text-primary">
                  Ansehen <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild>
            <Link to="/berufe">
              <Search className="h-4 w-4 mr-1.5" />
              Alle Berufe durchsuchen
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/">Zur Startseite</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ProductPageTemplate
      product={product}
      paywall={paywall ?? null}
      onCtaClick={handleCtaClick}
      onFaqExpand={handleFaqExpand}
      onRelatedCourseClick={handleRelatedCourseClick}
    />
  );
}
