import { Link } from "react-router-dom";
import { BERUFOS } from "@/lib/berufos/brand";

/**
 * Cross-Brand-Footer-Bridge: zeigt auf examfit.de + jeder Legacy-Domain
 * "Teil von BerufOS — der AI-Plattform für Berufe" und verlinkt auf den Hub.
 * Phase M2 der Masterbrand-Migration.
 *
 * Bewusst zurückhaltend: kleines Label, kein CTA, keine Farbverschiebung.
 * Soll Vertrauen aufbauen, nicht ablenken vom ExamFit-Funnel.
 */
export function BerufOSPlatformBadge({ className = "" }: { className?: string }) {
  return (
    <div
      className={`text-xs text-muted-foreground flex items-center justify-center gap-2 flex-wrap ${className}`}
    >
      <span>Teil von</span>
      <Link
        to="/berufos"
        className="font-medium text-foreground hover:underline underline-offset-4"
        aria-label={`${BERUFOS.name} — ${BERUFOS.tagline}`}
      >
        {BERUFOS.name}
      </Link>
      <span aria-hidden="true">·</span>
      <span className="hidden sm:inline">{BERUFOS.tagline}</span>
    </div>
  );
}
