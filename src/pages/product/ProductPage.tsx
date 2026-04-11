import { useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useProductPageSSOT } from '@/hooks/useProductPageSSOT';
import { ProductPageTemplate } from '@/components/product/ProductPageTemplate';
import { trackEvent } from '@/lib/tracking/track';

export default function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: product, isLoading, error } = useProductPageSSOT(slug);
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

  // Pricing section visibility tracking
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-4">
        <h1 className="text-2xl font-display font-bold">Prüfungstraining nicht gefunden</h1>
        <p className="text-muted-foreground text-center">
          Das gewünschte Prüfungstraining konnte nicht geladen werden.
        </p>
      </div>
    );
  }

  return (
    <ProductPageTemplate
      product={product}
      onCtaClick={handleCtaClick}
      onFaqExpand={handleFaqExpand}
      onRelatedCourseClick={handleRelatedCourseClick}
    />
  );
}
