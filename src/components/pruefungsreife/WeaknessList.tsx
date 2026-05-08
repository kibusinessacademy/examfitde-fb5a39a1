import { AlertTriangle, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { CATEGORY_LABELS, type CategoryKey } from "./types";

interface Props {
  weakest: CategoryKey[];
  /** Wenn gesetzt, wird jede Schwäche zu einem klickbaren Deep-Link ins Bundle-Modul. */
  bundleHref?: string;
  onItemClick?: (cat: CategoryKey) => void;
}

const FOCUS_HINT: Record<CategoryKey, string> = {
  lernstand: "Strukturierter Aufbau deiner Kerninhalte mit MiniChecks.",
  pruefungspraxis: "Vollständige Simulationen unter echtem Zeitlimit.",
  zeitmanagement: "Klarer Lernplan bis zur Prüfung mit Wochenzielen.",
  schriftliche_sicherheit: "Schriftliche Aufgaben mit konkretem Feedback.",
  muendliche_sicherheit: "Mündliches Training inkl. Fachgespräch-Simulation.",
  typische_fehler: "Schwächenanalyse priorisiert die kostspieligsten Themen.",
  wiederholungssystem: "Wiederholung deiner schwächsten Themen mit System.",
  pruefungsangst: "Routine durch realistische Prüfungssimulationen aufbauen.",
};

/** Mapping CategoryKey → Bundle-Modul-Anchor (für Deep-Link). */
const MODULE_ANCHOR: Record<CategoryKey, string> = {
  lernstand: "modul-lernkurs",
  pruefungspraxis: "modul-pruefungstrainer",
  zeitmanagement: "modul-lernplan",
  schriftliche_sicherheit: "modul-pruefungstrainer",
  muendliche_sicherheit: "modul-simulation",
  typische_fehler: "modul-readiness",
  wiederholungssystem: "modul-minichecks",
  pruefungsangst: "modul-simulation",
};

export function WeaknessList({ weakest, bundleHref, onItemClick }: Props) {
  if (weakest.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-warning" />
        Deine drei größten Schwächen
      </h3>
      <ul className="space-y-2">
        {weakest.map((cat) => {
          const content = (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-text-primary">{CATEGORY_LABELS[cat]}</div>
                  <div className="text-sm text-text-secondary">{FOCUS_HINT[cat]}</div>
                </div>
                {bundleHref && (
                  <ArrowRight className="h-4 w-4 text-primary mt-1 shrink-0" aria-hidden />
                )}
              </div>
            </>
          );

          if (bundleHref) {
            return (
              <li key={cat}>
                <Link
                  to={`${bundleHref}#${MODULE_ANCHOR[cat]}`}
                  onClick={() => onItemClick?.(cat)}
                  className="block rounded-lg border border-transparent hover:border-primary hover:bg-primary/5 active:scale-[0.99] transition-all p-3 -m-3"
                >
                  {content}
                </Link>
              </li>
            );
          }
          return (
            <li key={cat} className="p-0">
              {content}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
