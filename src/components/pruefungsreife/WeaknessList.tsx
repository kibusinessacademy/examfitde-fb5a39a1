import { AlertTriangle } from "lucide-react";
import { CATEGORY_LABELS, type CategoryKey } from "./types";

interface Props {
  weakest: CategoryKey[];
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

export function WeaknessList({ weakest }: Props) {
  if (weakest.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-warning" />
        Deine drei größten Schwächen
      </h3>
      <ul className="space-y-3">
        {weakest.map((cat) => (
          <li key={cat} className="text-sm">
            <div className="font-medium text-text-primary">{CATEGORY_LABELS[cat]}</div>
            <div className="text-text-secondary">{FOCUS_HINT[cat]}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
