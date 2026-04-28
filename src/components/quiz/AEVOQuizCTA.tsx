/**
 * AEVOQuizCTA — wiederverwendbarer Quiz-Einstieg für AEVO-Cluster-Seiten.
 *
 * Slots: hero | mid | footer
 * Tracking: emit LEAD_MAGNET_VIEW mit metadata.cta_location + source_page
 *           (kein neues DB-Constraint nötig, Auswertung über metadata).
 *
 * Primärer Funnel: SEO-Seite → Quiz → Ergebnis → Lernplan/Simulation/Bundle.
 * Daher KEIN direkter Bundle-Push auf den Cluster-Seiten — Quiz first.
 */
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
}

export function AEVOQuizCTA({
  quizSlug = "aevo-pruefungsreife",
  location,
  label,
  subtitle,
  variant = "primary",
}: Props) {
  const loc = useLocation();
  const sourcePage = loc.pathname;

  const handleClick = () => {
    // SSOT-konformer Event-Name (LEAD_MAGNET_VIEW). Differenzierung über metadata.cta_location.
    emitFunnelEvent("LEAD_MAGNET_VIEW", {
      quiz_slug: quizSlug,
      cta_location: location,
      source: "aevo_cluster",
      source_page: sourcePage,
    });
  };

  // HERO: schlanker Inline-Button (ergänzt bestehenden Hero-CTA bzw. ersetzt ihn klickbar mit Tracking)
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

  // MID: prominenter Inline-Block zwischen Content-Sektionen
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

  // FOOTER: ganzbreiter CTA-Block (Quiz-First, NICHT Bundle)
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
            "Mache den AEVO-Selbsttest und erhalte deinen persönlichen 4-Wochen-Lernplan — kostenlos und ohne Registrierung."}
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

export default AEVOQuizCTA;
