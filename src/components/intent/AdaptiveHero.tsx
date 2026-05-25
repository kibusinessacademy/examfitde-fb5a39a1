import { useEffect, useRef } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveIntent } from "@/lib/intent/router";
import {
  chooseAdaptiveCta,
  type AdaptiveCtaDecision,
} from "@/lib/intent/adaptive-cta";
import { recordAdaptiveCtaDecision } from "@/lib/intent/decision-telemetry";
import type { IntentSignals, ResolvedIntent } from "@/lib/intent/types";

interface Props {
  /** Pre-resolved intent (preferred at page level). */
  intent?: ResolvedIntent;
  /** Raw signals — resolver runs deterministically. */
  signals?: IntentSignals;
  /** Optional extra context for the CTA engine. */
  extra?: { weakest_competency?: string; repeat_failures?: number };
  /** Custom click handler — receives the explainable decision. */
  onPrimary?: (decision: AdaptiveCtaDecision) => void;
  /** Optional eyebrow above the hero. */
  eyebrow?: string;
  className?: string;
  /** Telemetry context — surfaces in adaptive_cta_decision metadata. */
  telemetry?: {
    entity_kind?: string;
    entity_slug?: string;
    persona?: string | null;
    package_id?: string | null;
    confidence?: number | null;
    /** Default true — set false in unit/visual tests. */
    enabled?: boolean;
  };
}

const VARIANT_HEADLINE: Record<AdaptiveCtaDecision["variant"], string> = {
  motivational: "Du bist näher an der Prüfung als du denkst.",
  urgency: "Die Zeit läuft — aber du kannst sie nutzen.",
  risk: "Wo stehst du wirklich vor der Prüfung?",
  confidence: "Du bist auf Kurs — jetzt unter Prüfungsdruck testen.",
  simulation: "Bereit für eine realistische Probeprüfung?",
  oral: "Trainiere dein Fachgespräch realistisch.",
  recovery: "Gezielt aufholen statt alles wiederholen.",
  diagnostic: "In 4 Minuten weißt du, wo du stehst.",
};

const TONE_BG: Record<AdaptiveCtaDecision["tone"], string> = {
  calm: "from-petrol-50 to-background",
  direct: "from-mint-50 to-background",
  empathic: "from-amber-50 to-background",
  sharp: "from-rose-50 to-background",
};

/**
 * Adaptive Hero — reacts to intent / readiness / exam phase. Every render
 * carries `data-cta-reason` so analytics can attribute outcomes back to the
 * explainable_cta_reason SSOT.
 */
export function AdaptiveHero({
  intent,
  signals,
  extra,
  onPrimary,
  eyebrow = "Dein nächster Schritt",
  className,
}: Props) {
  const resolved = intent ?? resolveIntent(signals ?? {});
  const decision = chooseAdaptiveCta(resolved, signals ?? {}, extra ?? {});
  const headline = VARIANT_HEADLINE[decision.variant];

  return (
    <section
      className={
        "rounded-2xl border border-border bg-gradient-to-br p-6 sm:p-10 " +
        TONE_BG[decision.tone] +
        " " +
        (className ?? "")
      }
      data-intent={resolved.primary}
      data-cta-variant={decision.variant}
      data-cta-tone={decision.tone}
      data-cta-urgency={decision.urgency_level}
      data-cta-reason={decision.reason}
      aria-labelledby="adaptive-hero-headline"
    >
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        {eyebrow}
      </div>
      <h2
        id="adaptive-hero-headline"
        className="mt-3 max-w-2xl text-2xl font-display font-bold text-foreground sm:text-3xl"
      >
        {headline}
      </h2>
      <p className="mt-3 max-w-2xl text-base text-muted-foreground">
        {decision.message}
      </p>
      <div className="mt-6">
        <Button
          size="lg"
          className="rounded-xl"
          onClick={() => onPrimary?.(decision)}
          data-cta="adaptive_hero_primary"
          data-cta-surface={decision.action_type}
        >
          {decision.message.length > 56 ? "Jetzt starten" : decision.message}
          <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
        </Button>
      </div>
    </section>
  );
}
