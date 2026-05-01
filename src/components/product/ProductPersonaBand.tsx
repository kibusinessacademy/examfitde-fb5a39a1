import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";
import type { ProductPersonaContext } from "@/lib/landing/productPersonaContext";

interface Props {
  context: ProductPersonaContext;
  productName: string;
  onCtaClick?: () => void;
}

/**
 * Persona-Band oberhalb des Product-Hero.
 * Zeigt Audience-Chip, Persona-Headline-Variante + Diagnose-CTA.
 * Keine eigene Produktwahrheit — Routing-/Copy-Layer only.
 */
export function ProductPersonaBand({ context, productName, onCtaClick }: Props) {
  return (
    <section
      className="w-full border-b border-border bg-surface-subtle"
      data-persona={context.persona}
    >
      <div className="container mx-auto max-w-5xl px-4 py-8 md:py-10">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              {context.intentChip}
            </span>
            <h2 className="text-xl font-semibold text-foreground md:text-2xl">
              {context.headlinePrefix(productName)}
            </h2>
            <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
              {context.subline(productName)}
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 md:items-end">
            <Button
              size="lg"
              onClick={onCtaClick}
              className="rounded-xl"
              data-cta="persona_diagnose"
            >
              {context.ctaPrimary}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground">{context.ctaHint}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
