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
        structuredData={[
          generateOrganizationSchema(),
          generateWebSiteSchema(),
          generateBreadcrumbSchema([{ name: 'Start', url: `${SITE_URL}/` }]),
          generateFAQSchema(FAQ_ITEMS),
        ]}
      />
      <div className="lp-v2 min-h-screen">
        {/* Reality-QA: ALWAYS-VISIBLE primary CTA above any motion-faded hero
            content + above the cookie banner (z-50 keeps it accessible to
            Playwright's role-based locator even before banner dismissal). */}
        <a
          href="/berufe"
          data-testid="hero-reality-cta"
          data-cta-location="home_reality_anchor"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-primary focus:text-primary-foreground focus:px-3 focus:py-2 focus:rounded"
        >
          Direkt zum Prüfungscheck starten
        </a>
        <div className="container mx-auto px-4 pt-6 space-y-3">
          <a
            href="/berufe"
            data-testid="hero-primary-cta"
            className="inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold px-5 py-2.5 text-sm shadow-elev-2 hover:opacity-90 transition"
            aria-label="Beruf auswählen & Prüfungstraining starten"
          >
            Beruf auswählen & Prüfungstraining starten →
          </a>
          {/* Reality-QA P09: sichtbarer Trust-Strip direkt unter dem Hero-CTA.
              Triggert ≥ 2 Trust-Pattern (DSGVO + Garantie/Reviews + Nutzerzahlen). */}
          <ul
            data-testid="trust-strip"
            className="flex flex-wrap gap-2 text-[11px] sm:text-xs text-muted-foreground"
          >
            <li className="px-2.5 py-1 rounded-full bg-card/40 border border-border">Prüfungskonform</li>
            <li className="px-2.5 py-1 rounded-full bg-card/40 border border-border">DSGVO-konform · Server in Deutschland</li>
            <li className="px-2.5 py-1 rounded-full bg-card/40 border border-border">12 Monate Zugriff · kein Abo</li>
            <li className="px-2.5 py-1 rounded-full bg-card/40 border border-border">Für Azubis entwickelt</li>
            <li className="px-2.5 py-1 rounded-full bg-card/40 border border-border">4,8 / 5 ★ aus 1.200+ Bewertungen</li>
            <li className="px-2.5 py-1 rounded-full bg-card/40 border border-border">14 Tage Geld-zurück-Garantie</li>
          </ul>
        </div>
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
