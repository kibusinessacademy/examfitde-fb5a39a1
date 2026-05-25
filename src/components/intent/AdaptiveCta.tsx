import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ctaFor } from "@/lib/intent/cta-map";
import { resolveIntent } from "@/lib/intent/router";
import type { IntentSignals, RecommendedSurface, ResolvedIntent } from "@/lib/intent/types";

interface Props {
  /** Pre-resolved intent (preferred when resolver runs at page level). */
  intent?: ResolvedIntent;
  /** Raw signals — resolver will be invoked deterministically. */
  signals?: IntentSignals;
  onClick?: (surface: RecommendedSurface, intent: ResolvedIntent) => void;
  /** Hide secondary CTA in tight contexts (sticky bars). */
  compact?: boolean;
  className?: string;
}

/**
 * Adaptive CTA — picks label + surface from the Intent SSOT. NEVER
 * hard-code CTA copy at the call-site.
 */
export function AdaptiveCta({ intent, signals, onClick, compact, className }: Props) {
  const resolved = intent ?? resolveIntent(signals ?? {});
  const cta = ctaFor(resolved);

  return (
    <div
      className={"flex flex-col gap-2 " + (className ?? "")}
      data-intent={resolved.primary}
      data-intent-urgency={resolved.urgency}
      data-intent-emotion={resolved.emotional_state}
    >
      <div className="flex flex-wrap gap-2">
        <Button
          size="lg"
          className="rounded-xl"
          onClick={() => onClick?.(cta.primary.surface, resolved)}
          data-cta="intent_primary"
          data-cta-surface={cta.primary.surface}
        >
          {cta.primary.label}
          <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
        </Button>
        {!compact && cta.secondary ? (
          <Button
            size="lg"
            variant="outline"
            className="rounded-xl"
            onClick={() => cta.secondary && onClick?.(cta.secondary.surface, resolved)}
            data-cta="intent_secondary"
            data-cta-surface={cta.secondary.surface}
          >
            {cta.secondary.label}
          </Button>
        ) : null}
      </div>
      {cta.hint ? (
        <p className="text-xs text-muted-foreground">{cta.hint}</p>
      ) : null}
    </div>
  );
}
