import { useState } from "react";
import { CheckCircle2, Circle, AlertCircle } from "lucide-react";

type Status = "mastered" | "partial" | "not";

interface Comp {
  id: string;
  name: string;
  status: Status;
  weakness: string;
  recommendation: string;
}

const COMPS: Comp[] = [
  {
    id: "c1",
    name: "Rechnungswesen",
    status: "mastered",
    weakness: "Keine größeren Lücken erkannt.",
    recommendation: "Halte das Niveau mit 1× wöchentlichem MiniCheck.",
  },
  {
    id: "c2",
    name: "Kosten- und Leistungsrechnung",
    status: "partial",
    weakness: "Verständnis der Vollkostenrechnung lückenhaft.",
    recommendation: 'MiniCheck Kapitel 3 + 2 Übungsaufgaben Stufe „Mittel".',
  },
  {
    id: "c3",
    name: "Steuerliche Grundlagen",
    status: "not",
    weakness: "Kaum sichere Antworten in Bewertungs­fragen.",
    recommendation: "Lernkurs Kapitel 5 + KI-Tutor für offene Fragen.",
  },
  {
    id: "c4",
    name: "Bilanzanalyse",
    status: "partial",
    weakness: "Kennzahlen werden vertauscht.",
    recommendation: "MiniCheck Kennzahlen + 1 mündliche Simulation.",
  },
];

const STATUS_META: Record<Status, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  mastered: {
    label: "Sicher",
    cls: "bg-success-bg-subtle text-success border-success-border",
    Icon: CheckCircle2,
  },
  partial: {
    label: "Teilweise",
    cls: "bg-warning-bg-subtle text-warning border-warning-border",
    Icon: AlertCircle,
  },
  not: {
    label: "Lücke",
    cls: "bg-destructive-bg-subtle text-destructive border-destructive-border",
    Icon: Circle,
  },
};

export function CompetencyMasteryDemo() {
  const [openId, setOpenId] = useState<string | null>("c3");

  return (
    <div
      className="rounded-2xl bg-surface-raised border border-border-subtle p-5 sm:p-6 shadow-elev-2"
      data-demo="competency-mastery"
    >
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
          Beispiel · Kompetenz-Übersicht
        </span>
        <span className="text-xs text-text-tertiary">{COMPS.length} Kompetenzen</span>
      </div>

      <ul className="space-y-2">
        {COMPS.map((c) => {
          const meta = STATUS_META[c.status];
          const open = openId === c.id;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setOpenId(open ? null : c.id)}
                className="w-full text-left rounded-xl border border-border bg-surface px-4 py-3 hover:border-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-expanded={open}
                aria-label={`${c.name} – Status ${meta.label}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <meta.Icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="font-medium text-text-primary truncate">{c.name}</span>
                  </div>
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${meta.cls}`}
                  >
                    {meta.label}
                  </span>
                </div>
                {open && (
                  <div className="mt-3 grid gap-2 text-sm">
                    <div>
                      <div className="text-text-tertiary text-xs uppercase tracking-wide mb-0.5">
                        Schwäche
                      </div>
                      <div className="text-text-secondary">{c.weakness}</div>
                    </div>
                    <div>
                      <div className="text-text-tertiary text-xs uppercase tracking-wide mb-0.5">
                        Empfehlung
                      </div>
                      <div className="text-text-secondary">{c.recommendation}</div>
                    </div>
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
