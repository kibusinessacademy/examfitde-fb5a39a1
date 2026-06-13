import { Helmet } from "react-helmet-async";
import { cn } from "@/lib/utils";

/**
 * RouteIdentityBlock — KIMI.2 QFAF Sweep (Q1: "Wo bin ich?")
 *
 * Pflicht-Komponente für jede Learner-Route. Beantwortet auf einen Blick:
 *   1) seitenspezifischer <title> (statt Sitewide-Brand)
 *   2) sichtbares H1
 *   3) Untertitel = Bedeutung für die Prüfung (Q2 "Stakes")
 *
 * Bewusst minimal stilisiert (token-basiert), damit jede Surface ihre eigene
 * Optik behält. Keine Brand-Gradients, kein neuer Header-Container.
 */
export interface RouteIdentityBlockProps {
  /** H1 + <title>-Präfix. Beispiel: "AI Tutor". */
  title: string;
  /** Optionaler Kontext-Untertitel ("Dein persönlicher Prüfungscoach …"). */
  subtitle?: string;
  /** Optional: Beruf/Curriculum-Kontext-Zeile ("für Fachinformatiker AE"). */
  contextLine?: string;
  /** Eigene <meta description> für diese Route. */
  description?: string;
  /** Optional: Eyebrow-Label ("Tutor · Beobachtung"). */
  eyebrow?: string;
  /** Wenn true: H1 visuell versteckt, aber semantisch vorhanden. */
  h1Hidden?: boolean;
  className?: string;
  /** data-testid Anker für KIMI-Auditor. */
  testId?: string;
}

export function RouteIdentityBlock({
  title,
  subtitle,
  contextLine,
  description,
  eyebrow,
  h1Hidden = false,
  className,
  testId = "route-identity-block",
}: RouteIdentityBlockProps) {
  const fullTitle = `${title} – ExamFit`;
  return (
    <>
      <Helmet>
        <title>{fullTitle}</title>
        {description ? <meta name="description" content={description} /> : null}
      </Helmet>
      <section
        data-testid={testId}
        className={cn("mb-5", className)}
        aria-labelledby="route-identity-h1"
      >
        {eyebrow ? (
          <p className="text-[11px] uppercase tracking-[0.18em] text-text-secondary mb-1">
            {eyebrow}
          </p>
        ) : null}
        <h1
          id="route-identity-h1"
          className={cn(
            "font-display font-bold leading-tight text-text-primary",
            h1Hidden ? "sr-only" : "text-2xl sm:text-3xl"
          )}
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm sm:text-base text-text-secondary leading-snug">
            {subtitle}
          </p>
        ) : null}
        {contextLine ? (
          <p
            className="mt-0.5 text-xs sm:text-sm text-text-tertiary"
            data-testid="route-identity-context"
          >
            {contextLine}
          </p>
        ) : null}
      </section>
    </>
  );
}
