/**
 * QuizCTA — wiederverwendbarer Lead-Magnet-CTA für SEO-/Pillar-Cluster.
 *
 * SSOT-Tracking:
 *   - Mount  → LEAD_MAGNET_VIEW   (Impression, einmal pro Slot)
 *   - Click  → QUIZ_CTA_CLICKED   (distinktes Event, nicht mit Views vermischt)
 *
 * Cluster-agnostisch — quizSlug + cluster + label/subtitle frei wählbar.
 * Default zeigt das AEVO-Pilot-Quiz. Funnel: SEO-Seite → Quiz → Lernplan/Bundle.
 */
import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { emitFunnelEvent } from "@/lib/funnelEvents";

export type CtaLocation = "hero" | "mid" | "footer";

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
  /** Track-Source-Cluster (z. B. "aevo_cluster", "wfw_cluster") */
  cluster?: string;
}

export function QuizCTA({
  quizSlug = "aevo-pruefungsreife",
  location,
  label,
  subtitle,
  variant = "primary",
  cluster = "generic",
}: Props) {
  const loc = useLocation();
  const sourcePage = loc.pathname;
  const impressionFired = useRef(false);

  useEffect(() => {
    if (impressionFired.current) return;
    impressionFired.current = true;
    emitFunnelEvent("LEAD_MAGNET_VIEW", {
      quiz_slug: quizSlug,
      cta_location: location,
      source: cluster,
      source_page: sourcePage,
    });
  }, [quizSlug, location, cluster, sourcePage]);

  const handleClick = () => {
    emitFunnelEvent("QUIZ_CTA_CLICKED", {
      quiz_slug: quizSlug,
      cta_location: location,
      source: cluster,
      source_page: sourcePage,
    });
  };

  if (location === "hero") {
    return (
      <Button
        size="lg"
        className={
          variant === "primary"
            ? "gradient-primary text-primary-foreground shadow-glow h-14 px-8 text-lg"
            : "h-14 px-8"
        }
        variant={variant === "primary" ? "default" : "outline"}
        asChild
        onClick={handleClick}
      >
        <Link to={`/quiz/${quizSlug}`}>
          {label ?? "Gratis: Bin ich prüfungsreif?"}
          <ArrowRight className="ml-2 h-5 w-5" />
        </Link>
      </Button>
    );
  }

  if (location === "mid") {
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-6 flex flex-col md:flex-row items-start md:items-center gap-4 justify-between">
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
          <Button asChild onClick={handleClick} className="shrink-0">
            <Link to={`/quiz/${quizSlug}`}>
              Selbsttest starten <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // FOOTER
  return (
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
