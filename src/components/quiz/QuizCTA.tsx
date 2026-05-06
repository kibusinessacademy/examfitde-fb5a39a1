/**
 * QuizCTA — wiederverwendbarer Lead-Magnet-CTA für SEO-/Pillar-Cluster.
 *
 * SSOT-Tracking:
 *   - Mount/Sichtbar  → LEAD_MAGNET_VIEW (Impression, einmal pro Slot)
 *   - Sichtbar        → cta_visible      (Heatmap/CTR-Auswertung, einmal pro Slot)
 *   - Click           → QUIZ_CTA_CLICKED + cta_clicked
 *
 * A/B-Variante:
 *   - Sticky per Visitor (localStorage `ef_cta_variant` = "A" | "B")
 *   - Variante landet IMMER unter `metadata.variant`
 *   - Cluster-Identifier landet IMMER unter `metadata.source` (SSOT — niemals `metadata.cluster`)
 */
import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { emitFunnelEvent } from "@/lib/funnelEvents";
import { trackFunnel } from "@/lib/conversionTracking";

export type CtaLocation = "hero" | "mid" | "footer" | "contextual";

interface Props {
  /** quiz_slug, default: "aevo-pruefungsreife" */
  quizSlug?: string;
  location: CtaLocation;
  /** Optionaler eigener CTA-Text */
  label?: string;
  /** Optionaler eigener Sub-Text (nur mid/footer) */
  subtitle?: string;
  /** Visueller Stil */
  variant?: "primary" | "outline";
  /** Track-Source-Cluster (z. B. "aevo_cluster", "wfw_cluster") — landet in metadata.source */
  cluster?: string;
}

const VARIANT_KEY = "ef_cta_variant";

function getCtaVariant(): "A" | "B" {
  if (typeof window === "undefined") return "A";
  try {
    let v = window.localStorage.getItem(VARIANT_KEY);
    if (v !== "A" && v !== "B") {
      v = Math.random() < 0.5 ? "A" : "B";
      window.localStorage.setItem(VARIANT_KEY, v);
    }
    return v as "A" | "B";
  } catch {
    return "A";
  }
}

export function QuizCTA({
  quizSlug = "aevo-pruefungsreife",
  location,
  label,
  subtitle,
  variant: visualVariant = "primary",
  cluster = "generic",
}: Props) {
  const loc = useLocation();
  const sourcePage = loc.pathname;
  const impressionFired = useRef(false);
  const visibleFired = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const abVariant = getCtaVariant();

  // Mount-Impression (LEAD_MAGNET_VIEW) — Bestandstracking
  useEffect(() => {
    if (impressionFired.current) return;
    impressionFired.current = true;
    emitFunnelEvent("LEAD_MAGNET_VIEW", {
      quiz_slug: quizSlug,
      cta_location: location,
      source: cluster, // SSOT: cluster IMMER unter metadata.source
      source_page: sourcePage,
      variant: abVariant,
    });
  }, [quizSlug, location, cluster, sourcePage, abVariant]);

  // Echte Sichtbarkeit (IntersectionObserver) → cta_visible (für CTR)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !visibleFired.current) {
            visibleFired.current = true;
            void trackFunnel("cta_visible", {
              metadata: {
                source: cluster,
                cta_location: location,
                element_id: "quiz_cta",
                quiz_slug: quizSlug,
                variant: abVariant,
                page_path: sourcePage,
              },
              source_page: sourcePage,
            });
            obs.disconnect();
          }
        }
      },
      { threshold: 0.5 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [cluster, location, quizSlug, abVariant, sourcePage]);

  const handleClick = () => {
    emitFunnelEvent("QUIZ_CTA_CLICKED", {
      quiz_slug: quizSlug,
      cta_location: location,
      source: cluster, // SSOT
      source_page: sourcePage,
      variant: abVariant,
    });
    void trackFunnel("cta_clicked", {
      metadata: {
        source: cluster,
        cta_location: location,
        element_id: "quiz_cta",
        quiz_slug: quizSlug,
        variant: abVariant,
        page_path: sourcePage,
      },
      source_page: sourcePage,
    });
  };

  const heatmapAttrs = {
    "data-heatmap-id": "quiz_cta",
    "data-cta-location": location,
    "data-cta-variant": abVariant,
  } as Record<string, string>;

  if (location === "hero") {
    // A: gradient/primary  · B: outline/sekundär — kleinster sinnvoller Stil-Split
    const useOutline = visualVariant === "outline" || abVariant === "B";
    return (
      <div ref={containerRef} className="inline-block">
        <Button
          size="lg"
          className={
            useOutline
              ? "h-14 px-8"
              : "gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg"
          }
          variant={useOutline ? "outline" : "default"}
          asChild
          onClick={handleClick}
          {...heatmapAttrs}
        >
          <Link to={`/quiz/${quizSlug}`}>
            {label ?? "Gratis: Bin ich prüfungsreif?"}
            <ArrowRight className="ml-2 h-5 w-5" />
          </Link>
        </Button>
      </div>
    );
  }

  if (location === "mid" || location === "contextual") {
    // B-Variante schiebt CTA-Button visuell nach oben (above-the-fold-Eindruck)
    const reversed = abVariant === "B";
    return (
      <div ref={containerRef}>
        <Card className="border-primary/30 bg-primary/5">
          <CardContent
            className={`py-6 flex flex-col md:flex-row items-start md:items-center gap-4 justify-between ${reversed ? "md:flex-row-reverse" : ""}`}
          >
            <div className="flex items-start gap-3">
              <Sparkles className="h-6 w-6 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">
                  {label ?? "Bist du schon prüfungsreif? 5-Fragen-Selbsttest"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {subtitle ??
                    "Anonym · 2 Minuten · sofortiges Ergebnis + persönlicher Lernplan."}
                </p>
              </div>
            </div>
            <Button asChild onClick={handleClick} className="shrink-0" {...heatmapAttrs}>
              <Link to={`/quiz/${quizSlug}`}>
                Selbsttest starten <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // FOOTER
  return (
    <div ref={containerRef}>
      <section className="py-16 bg-gradient-to-br from-primary/10 via-transparent to-accent/10">

      <div className="container text-center max-w-3xl space-y-5">
        <div className="inline-flex items-center gap-2 text-primary">
          <Target className="h-5 w-5" />
          <span className="text-sm font-medium uppercase tracking-wide">
            Nächster Schritt
          </span>
        </div>
        <h2 className="text-3xl font-display font-bold">
          {label ?? "Finde in 2 Minuten heraus, wo du stehst"}
        </h2>
        <p className="text-lg text-muted-foreground">
          {subtitle ??
            "Mache den Selbsttest und erhalte deinen persönlichen Lernplan — kostenlos und ohne Registrierung."}
        </p>
        <Button
          size="lg"
          className="gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg"
          asChild
          onClick={handleClick}
          {...heatmapAttrs}
        >
          <Link to={`/quiz/${quizSlug}`}>
            Selbsttest starten <ArrowRight className="ml-2 h-5 w-5" />
          </Link>
        </Button>
      </div>
    </section>
  );
}

/** Backwards-compat Alias — bestehende AEVO-Imports brechen nicht. */
export const AEVOQuizCTA = QuizCTA;
export default QuizCTA;
