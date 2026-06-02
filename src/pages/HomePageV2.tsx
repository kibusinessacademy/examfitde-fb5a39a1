import { useEffect } from "react";
import { SEOHead } from "@/components/seo/SEOHead";
import {
  generateOrganizationSchema,
  generateWebSiteSchema,
  generateBreadcrumbSchema,
} from "@/lib/seo";
import { generateFAQSchema, SITE_URL, seoTitle } from "@/lib/seo";
import { trackConversion } from "@/lib/seo-tracking";
import { StickyCTA } from "@/components/marketing/StickyCTA";

import "@/components/landing/v2/lp-v2-theme.css";
import { PremiumHero } from "@/components/landing/v2/PremiumHero";
import { StoryScrollSection } from "@/components/landing/v2/StoryScrollSection";
import { ReadinessRevealScene } from "@/components/landing/v2/ReadinessRevealScene";
import { WhyNotChatGPTSection } from "@/components/landing/v2/WhyNotChatGPTSection";
import { BentoDemoGrid } from "@/components/landing/v2/BentoDemoGrid";
import { NotAnotherCourseSection } from "@/components/landing/v2/NotAnotherCourseSection";
import { TrustPillars } from "@/components/landing/v2/TrustPillars";
import { BerufeShowcase } from "@/components/landing/v2/BerufeShowcase";
import { MobileCourseFinder } from "@/components/landing/v2/MobileCourseFinder";
import { FAQSection, FAQ_ITEMS } from "@/components/landing/v2/FAQSection";
import { FinalCTASection } from "@/components/landing/v2/FinalCTASection";

/**
 * Premium Landing V2 — dark AI-SaaS experience, scoped via `.lp-v2`.
 * Composes: PremiumHero → Story-Scroll → Bento Demos → Trust → Berufe → FAQ → Final.
 */
export default function HomePageV2() {
  useEffect(() => {
    trackConversion({ event: "page_view", source: "homepage_v2" });

    const thresholds = [25, 50, 75];
    const fired = new Set<number>();
    const onScroll = () => {
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight <= 0) return;
      const pct = Math.round((window.scrollY / docHeight) * 100);
      for (const t of thresholds) {
        if (pct >= t && !fired.has(t)) {
          fired.add(t);
          trackConversion({
            event: "scroll_depth",
            source: "homepage_v2",
            label: `${t}pct`,
            value: t,
          });
        }
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <SEOHead
        title={seoTitle("Bestehe deine Prüfung nicht zufällig — Prüfungstraining mit KI")}
        description="ExamFit ist das erste intelligente Prüfungstrainingssystem für IHK & HWK: Prüfungsreife-Check, adaptive Schwächenanalyse, KI-Tutor mit Quellen, schriftliche und mündliche Simulation. Kein Abo."
        canonical={`${SITE_URL}/`}
        type="website"
        structuredData={[generateFAQSchema(FAQ_ITEMS)]}
      />
      <div className="lp-v2 min-h-screen">
        <PremiumHero />
        <MobileCourseFinder />
        <StoryScrollSection />
        <ReadinessRevealScene />
        <WhyNotChatGPTSection />
        <BentoDemoGrid />
        <NotAnotherCourseSection />
        <TrustPillars />
        <BerufeShowcase />
        <FAQSection />
        <FinalCTASection />
        <StickyCTA />
      </div>
    </>
  );
}
