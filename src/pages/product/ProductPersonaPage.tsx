import { useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useProductPageSSOT } from "@/hooks/useProductPageSSOT";
import { useResolvePaywall } from "@/hooks/useResolvePaywall";
import { ProductPageTemplate } from "@/components/product/ProductPageTemplate";
import { trackEvent } from "@/lib/tracking/track";
import { useTrackGrowthEvent } from "@/hooks/useTrackGrowthEvent";
import {
  isProductPersona,
  getProductPersonaContext,
  type ProductPersona,
} from "@/lib/landing/productPersonaContext";
import { SITE_URL } from "@/lib/seo";

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

  const trackedViewRef = useRef<string | null>(null);
  const trackedLeadMagnetRef = useRef<string | null>(null);

  // Persona-aware tracking: landing_view + lead_magnet_view (SSOT v2 funnel)
  useEffect(() => {
    if (!product) return;
    const key = `${product.canonicalSlug}::${persona}`;

    if (trackedViewRef.current !== key) {
      trackedViewRef.current = key;
      // Legacy product_view (tracking_events) — backwards compat
      trackEvent({
        eventName: "product_view",
        productSlug: product.canonicalSlug,
        landingType: `persona_${persona}`,
        metadata: { persona_type: persona, package_id: product.packageId },
      });
      // SSOT v2 — conversion_events with package_id + persona
      track("lead_magnet_view", {
        packageId: product.packageId,
        persona,
        sourcePage: `/pruefungstraining/${product.canonicalSlug}/${persona}`,
        metadata: {
          landing_type: "product_persona",
          product_slug: product.canonicalSlug,
          persona_type: persona,
        },
      });
    }

    // Separate landing_view ping for funnel parity
    if (trackedLeadMagnetRef.current !== key) {
      trackedLeadMagnetRef.current = key;
      track("paywall_view" /* placeholder bucket — see metadata.event_alias */, {
        packageId: product.packageId,
        persona,
        sourcePage: `/pruefungstraining/${product.canonicalSlug}/${persona}`,
        metadata: {
          event_alias: "landing_view",
          persona_type: persona,
          product_slug: product.canonicalSlug,
        },
      });
    }
  }, [product, persona, track]);

  // Persona-CTA → Diagnose/Quiz, mit package_id + persona im Querystring
  const handlePersonaCta = useCallback(() => {
    if (!product) return;
    track("cta_click", {
      packageId: product.packageId,
      persona,
      sourcePage: `/pruefungstraining/${product.canonicalSlug}/${persona}`,
      metadata: {
        cta_type: "persona_diagnose",
        target_path: personaContext.diagnoseTargetPath,
      },
    });
    const params = new URLSearchParams({
      package_id: product.packageId,
      persona,
      slug: product.canonicalSlug,
      source: `product_persona_${persona}`,
    });
    navigate(`${personaContext.diagnoseTargetPath}?${params.toString()}`);
  }, [product, persona, personaContext, navigate, track]);

  // Standard primary-CTA (Pricing-Card / Sticky-Bar) bleibt: führt zur Diagnose
  // — Persona-Pfad ist explizit Diagnose-first; Checkout läuft über Quiz-Bundle.
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

  const canonicalUrl = `${SITE_URL}/pruefungstraining/${product.canonicalSlug}/${persona}`;

  return (
    <ProductPageTemplate
      product={product}
      paywall={paywall ?? null}
      personaContext={personaContext}
      canonicalOverride={canonicalUrl}
      onCtaClick={handleCtaClick}
      onPersonaCtaClick={handlePersonaCta}
      onFaqExpand={handleFaqExpand}
    />
  );
}
