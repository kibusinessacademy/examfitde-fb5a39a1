import { useState } from "react";
import { Mic, Star } from "lucide-react";

type Quality = "weak" | "ok" | "strong";

const PROMPT = "Erklären Sie den Unterschied zwischen Voll- und Teilkostenrechnung im Praxisbezug.";

const RATINGS: Record<Quality, { label: string; scores: Record<string, number>; tip: string }> = {
  weak: {
    label: "Kurze Antwort",
    scores: { Fachlichkeit: 1, Struktur: 2, Begriffssicherheit: 1, Praxisbezug: 1 },
    tip: "Beginne mit einer klaren Definition und nenne ein Beispiel aus deinem Betrieb.",
  },
  ok: {
    label: "Mittlere Antwort",
    scores: { Fachlichkeit: 3, Struktur: 3, Begriffssicherheit: 3, Praxisbezug: 2 },
    tip: "Strukturiere stärker: Definition → Abgrenzung → Praxisbeispiel → Bewertung.",
  },
  strong: {
    label: "Vollständige Antwort",
    scores: { Fachlichkeit: 5, Struktur: 5, Begriffssicherheit: 4, Praxisbezug: 5 },
    tip: "Stark — präzisere Fachbegriffe (Fixkosten­proportionalisierung) heben dich noch höher.",
  },
};

export function OralExamDemo() {
  const [quality, setQuality] = useState<Quality | null>(null);
  const result = quality ? RATINGS[quality] : null;

  return (
    <div
      className="rounded-2xl bg-surface-raised border border-border-subtle p-5 sm:p-6 shadow-elev-2"
      data-demo="oral-exam"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
          Beispiel · Mündliche Simulation
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-primary">
          <Mic className="h-3.5 w-3.5" />
          Fachgespräch
        </span>
      </div>

      <div className="rounded-xl bg-surface-sunken p-4 mb-4">
        <div className="text-xs text-text-tertiary mb-1">Prüferfrage</div>
        <p className="text-sm text-text-primary">{PROMPT}</p>
      </div>

      <div className="text-sm text-text-secondary mb-2">Wähle eine Beispielantwort:</div>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {(Object.keys(RATINGS) as Quality[]).map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setQuality(q)}
            className={`px-2 py-2 rounded-lg border text-xs font-medium transition-colors ${
              quality === q
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-surface text-text-secondary hover:border-primary"
            }`}
          >
            {RATINGS[q].label}
          </button>
        ))}
      </div>

      {result && (
        <div className="space-y-3">
          <ul className="space-y-2">
            {Object.entries(result.scores).map(([dim, val]) => (
              <li key={dim} className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">{dim}</span>
                <span className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`h-3.5 w-3.5 ${
                        i < val ? "fill-warning text-warning" : "text-border"
                      }`}
                    />
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <div className="rounded-lg bg-info-bg-subtle border border-info-border p-3 text-sm text-info">
            {result.tip}
          </div>
        </div>
      )}
    </div>
  );
}
