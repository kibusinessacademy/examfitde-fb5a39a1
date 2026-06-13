import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * OutcomeHintBlock — KIMI.2 QFAF Sweep (Q4: "Was passiert nach dem Klick?")
 *
 * Pflicht-Komponente für jede Learner-Route mit Primary-CTA. Macht das
 * Ergebnis der nächsten Handlung sichtbar, bevor der Nutzer klickt.
 *
 * Bewusst dezent (border-subtle, surface-sunken), damit der Primary CTA
 * visuell dominant bleibt — Hint ist Kontext, nicht selbst CTA.
 */
export interface OutcomeHintBlockProps {
  /** Überschrift, z. B. "Nach dem Start:" oder "Nach Auswahl deines Berufs:". */
  heading?: string;
  /** Outcome-Aufzählung — 2–4 kurze Sätze. */
  bullets: string[];
  className?: string;
  /** data-testid Anker für KIMI-Auditor. */
  testId?: string;
}

export function OutcomeHintBlock({
  heading = "Nach dem Start:",
  bullets,
  className,
  testId = "route-outcome-hint",
}: OutcomeHintBlockProps) {
  if (!bullets?.length) return null;
  return (
    <aside
      data-testid={testId}
      className={cn(
        "rounded-lg border border-border-subtle bg-surface-sunken/60 px-4 py-3",
        className
      )}
      aria-label="Erwartetes Ergebnis nach dem nächsten Schritt"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-2">
        {heading}
      </p>
      <ul className="space-y-1.5">
        {bullets.map((b, i) => (
          <li
            key={i}
            className="flex items-start gap-2 text-sm text-text-primary leading-snug"
          >
            <Check className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" aria-hidden />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
