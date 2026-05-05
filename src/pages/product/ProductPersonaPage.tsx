import { useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useProductPageSSOT } from "@/hooks/useProductPageSSOT";
import { useResolvePaywall } from "@/hooks/useResolvePaywall";
import { useProductPersonaOverlay } from "@/hooks/useProductPersonaOverlay";
import { useBuyCtaExperiment } from "@/hooks/useBuyCtaExperiment";
import { ProductPageTemplate } from "@/components/product/ProductPageTemplate";
import { trackEvent } from "@/lib/tracking/track";
import { useTrackGrowthEvent } from "@/hooks/useTrackGrowthEvent";
import {
  isProductPersona,
  getProductPersonaContext,
  type ProductPersona,
  type ProductPersonaContext,
} from "@/lib/landing/productPersonaContext";
import { SITE_URL } from "@/lib/seo";
import type { ProductPageSSOT } from "@/types/product-page";

export default function ProductPersonaPage() {
  const { slug, persona: personaParam } = useParams<{ slug: string; persona: string }>();
  const navigate = useNavigate();
  const { track } = useTrackGrowthEvent();

  // Hard whitelist guard — invalid persona collapses to canonical product page.
  if (!isProductPersona(personaParam)) {
    return <Navigate to={`/pruefungstraining/${slug ?? ""}`} replace />;
  }
  const persona: ProductPersona = personaParam;
  const personaContext = getProductPersonaContext(persona);

  const { data: product, isLoading, error } = useProductPageSSOT(slug);
  const { data: paywall } = useResolvePaywall({
    packageId: product?.packageId ?? null,
    triggerContext: "product_page_view",
  });
  const { data: overlay } = useProductPersonaOverlay(product?.packageId ?? null, persona);
  const { variant: ctaVariant, label: ctaVariantLabel, experimentId: ctaExperimentId } = useBuyCtaExperiment();

  // ────────────────────────────────────────────────────────────────────────
  // Overlay-Merge (Presentation-only).
  // SSOT bleibt Truth. Overlay ersetzt NUR:
  //   heroKicker, heroHeadline, heroSubline,
  //   ctas.primaryLabel, ctas.secondaryLabel,
  //   uspItems (Titel-Liste), trustItems, painCopy (aus pain_points joined),
  //   seo.title, seo.metaDescription
  // NIEMALS: packageId, pricing, curriculumId, productId, capabilities,
  //          modules, faqItems, relatedCourses, capabilities, courseId, berufId.
  // ────────────────────────────────────────────────────────────────────────
  const mergedProduct: ProductPageSSOT | null = useMemo(() => {
    if (!product) return null;
    if (!overlay) return product;

    return {
      ...product,
      heroKicker: overlay.heroKicker ?? product.heroKicker,
      heroHeadline: overlay.heroHeadline || product.heroHeadline,
      heroSubline: overlay.heroSubline || product.heroSubline,
      painCopy:
        overlay.painPoints.length > 0
          ? overlay.painPoints.map((p) => `• ${p}`).join("\n")
          : product.painCopy,
      ctas: {
        ...product.ctas,
        primaryLabel:
          ctaVariantLabel || overlay.primaryCta || product.ctas.primaryLabel,
        secondaryLabel: overlay.secondaryCta ?? product.ctas.secondaryLabel,
      },
      uspItems:
        overlay.uspItems.length > 0
          ? overlay.uspItems.map((title) => ({ title, copy: "" }))
          : product.uspItems,
      trustItems:
        overlay.trustItems.length > 0
          ? overlay.trustItems.map((label) => ({ label }))
          : product.trustItems,
      seo: {
        ...product.seo,
        title: overlay.seoTitle || product.seo.title,
        metaDescription: overlay.seoDescription || product.seo.metaDescription,
        ogTitle: overlay.seoTitle || product.seo.ogTitle,
        ogDescription: overlay.seoDescription || product.seo.ogDescription,
      },
    };
  }, [product, overlay]);

  // Override personaContext SEO methods if overlay provides them
  const effectivePersonaContext: ProductPersonaContext = useMemo(() => {
    if (!overlay?.seoTitle && !overlay?.seoDescription) return personaContext;
    return {
      ...personaContext,
      seoTitleSuffix: overlay.seoTitle ? "" : personaContext.seoTitleSuffix,
      seoDescription: overlay.seoDescription
        ? () => overlay.seoDescription as string
        : personaContext.seoDescription,
    };
  }, [overlay, personaContext]);

  const trackedViewRef = useRef<string | null>(null);
  const trackedLeadMagnetRef = useRef<string | null>(null);

  // Persona-aware tracking: landing_view + lead_magnet_view (SSOT v2 funnel)
  useEffect(() => {
    if (!product) return;
    const key = `${product.canonicalSlug}::${persona}`;

    if (trackedViewRef.current !== key) {
      trackedViewRef.current = key;
      trackEvent({
        eventName: "product_view",
        productSlug: product.canonicalSlug,
        landingType: `persona_${persona}`,
        metadata: { persona_type: persona, package_id: product.packageId },
      });
      track("lead_magnet_view", {
        packageId: product.packageId,
        persona,
        sourcePage: `/pruefungstraining/${product.canonicalSlug}/${persona}`,
        metadata: {
          landing_type: "product_persona",
          product_slug: product.canonicalSlug,
          persona_type: persona,
          overlay_active: Boolean(overlay),
        },
      });
    }

    if (trackedLeadMagnetRef.current !== key) {
      trackedLeadMagnetRef.current = key;
      track("landing_view", {
        packageId: product.packageId,
        persona,
        sourcePage: `/pruefungstraining/${product.canonicalSlug}/${persona}`,
        metadata: {
          landing_type: "product_persona",
          product_slug: product.canonicalSlug,
          persona_type: persona,
          overlay_active: Boolean(overlay),
        },
      });
    }
  }, [product, persona, track, overlay]);

  const handlePersonaCta = useCallback(() => {
    if (!product) return;
    track("cta_click", {
      packageId: product.packageId,
      persona,
      sourcePage: `/pruefungstraining/${product.canonicalSlug}/${persona}`,
      metadata: {
        cta_type: "persona_diagnose",
        target_path: personaContext.diagnoseTargetPath,
        overlay_active: Boolean(overlay),
      },
    });
    const params = new URLSearchParams({
      package_id: product.packageId,
      persona,
      slug: product.canonicalSlug,
      source: `product_persona_${persona}`,
    });
    navigate(`${personaContext.diagnoseTargetPath}?${params.toString()}`);
  }, [product, persona, personaContext, navigate, track, overlay]);

  const handleCtaClick = useCallback(
    (ctaType: string) => {
      if (!product) return;
      trackEvent({
        eventName: "product_cta_click",
        productSlug: product.canonicalSlug,
        metadata: { cta_type: ctaType, persona_type: persona, package_id: product.packageId },
      });
      handlePersonaCta();
    },
    [product, persona, handlePersonaCta],
  );

  const handleFaqExpand = useCallback(
    (question: string) => {
      if (!product) return;
      trackEvent({
        eventName: "faq_expand",
        productSlug: product.canonicalSlug,
        metadata: { question, persona_type: persona },
      });
    },
    [product, persona],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !product || !mergedProduct) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-4">
        <h1 className="text-2xl font-display font-bold">Prüfungstraining nicht gefunden</h1>
        <p className="text-muted-foreground text-center">
          Das gewünschte Prüfungstraining konnte nicht geladen werden.
        </p>
      </div>
    );
  }

  const canonicalUrl = `${SITE_URL}/pruefungstraining/${product.canonicalSlug}/${persona}`;

  return (
    <ProductPageTemplate
      product={mergedProduct}
      paywall={paywall ?? null}
      personaContext={effectivePersonaContext}
      canonicalOverride={canonicalUrl}
      onCtaClick={handleCtaClick}
      onPersonaCtaClick={handlePersonaCta}
      onFaqExpand={handleFaqExpand}
    />
  );
}
