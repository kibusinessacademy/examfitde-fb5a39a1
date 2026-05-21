import { useState, useEffect, useCallback, useRef } from 'react';
import type { ProductPageSSOT } from '@/types/product-page';
import type { ResolvedPaywall } from '@/hooks/useResolvePaywall';
import type { ProductPersonaContext } from '@/lib/landing/productPersonaContext';
import { SEOHead } from '@/components/seo/SEOHead';
import { buildProductSEO } from '@/lib/product-page-seo';
import { ProductHeroSection } from './ProductHeroSection';
import { ProductPersonaBand } from './ProductPersonaBand';
import { ProductTrustBar } from './ProductTrustBar';
import { ProductPainBlock } from './ProductPainBlock';
import { ProductUSPBlock } from './ProductUSPBlock';
import { ProductModulesBlock } from './ProductModulesBlock';
import { ProductHowItWorksBlock } from './ProductHowItWorksBlock';
import { ProductProfessionFitBlock } from './ProductProfessionFitBlock';
import { ProductPricingCard } from './ProductPricingCard';
import { ProductFAQSection } from './ProductFAQSection';
import { ProductFinalCTABlock } from './ProductFinalCTABlock';
import { ProductRelatedCourses } from './ProductRelatedCourses';
import { StickyProductBar } from './StickyProductBar';
import { ProductPagePillarHub } from './ProductPagePillarHub';


interface Props {
  product: ProductPageSSOT;
  paywall?: ResolvedPaywall | null;
  onCtaClick: (ctaType: string) => void;
  onFaqExpand?: (question: string) => void;
  onRelatedCourseClick?: (slug: string) => void;
  isCheckoutLoading?: boolean;
  /** Optional persona-context (Routing-/Copy-Layer, NICHT Produktwahrheit). */
  personaContext?: ProductPersonaContext | null;
  /** Optionaler Canonical-Override (z.B. /pruefungstraining/:slug/:persona). */
  canonicalOverride?: string;
  /** Optionaler Persona-CTA-Handler (Diagnose/Quiz). */
  onPersonaCtaClick?: () => void;
}

export function ProductPageTemplate({
  product,
  onCtaClick,
  onFaqExpand,
  onRelatedCourseClick,
  isCheckoutLoading = false,
  personaContext = null,
  canonicalOverride,
  onPersonaCtaClick,
}: Props) {
  const [showStickyBar, setShowStickyBar] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);

  const seo = buildProductSEO(product);
  const canonical = canonicalOverride ?? seo.canonical;
  const seoTitle = personaContext
    ? `${product.canonicalTitle} ${personaContext.seoTitleSuffix} | ExamFit`.slice(0, 60)
    : seo.title;
  const seoDescription = personaContext
    ? personaContext.seoDescription(
        product.canonicalTitle,
        Number(product.pricing.amount).toFixed(0),
      )
    : seo.description;

  // Sticky bar visibility: show when hero leaves viewport
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowStickyBar(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handlePrimaryClick = useCallback(() => {
    onCtaClick('primary');
  }, [onCtaClick]);

  return (
    <>
      <SEOHead
        title={seoTitle}
        description={seoDescription}
        canonical={canonical}
        type="product"
        image={seo.ogImage || undefined}
        structuredData={seo.structuredData}
        price={product.pricing.amount}
        currency={product.pricing.currency}
        availability="InStock"
      />

      <article className="min-h-screen">
        {personaContext && (
          <ProductPersonaBand
            context={personaContext}
            productName={product.canonicalTitle}
            onCtaClick={onPersonaCtaClick}
          />
        )}

        <div ref={heroRef}>
          <ProductHeroSection
            product={product}
            onPrimaryClick={handlePrimaryClick}
            isLoading={isCheckoutLoading}
          />
        </div>

        <ProductTrustBar items={product.trustItems} />

        <ProductPainBlock product={product} />

        <ProductUSPBlock product={product} />

        <ProductModulesBlock product={product} />

        <ProductHowItWorksBlock product={product} />

        <ProductProfessionFitBlock product={product} />

        <ProductPricingCard
          product={product}
          onBuyClick={handlePrimaryClick}
          isLoading={isCheckoutLoading}
        />

        <ProductFAQSection
          items={product.faqItems}
          onExpand={onFaqExpand}
        />

        <ProductFinalCTABlock
          product={product}
          onBuyClick={handlePrimaryClick}
          isLoading={isCheckoutLoading}
        />

        <ProductRelatedCourses
          courses={product.relatedCourses}
          onCourseClick={onRelatedCourseClick}
        />
      </article>

      <StickyProductBar
        product={product}
        visible={showStickyBar}
        onBuyClick={handlePrimaryClick}
        isLoading={isCheckoutLoading}
      />
    </>
  );
}
