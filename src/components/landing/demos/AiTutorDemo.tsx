import { useState } from "react";
import { Brain, Quote, Sparkles } from "lucide-react";

const PROMPTS = [
  {
    id: "p1",
    label: "Was sind Erlösschmälerungen?",
    answer:
      "Erlösschmälerungen sind nachträgliche Abzüge vom Bruttoumsatz, etwa Skonti, Boni und Rabatte. Sie reduzieren den Bruttoumsatz auf den Nettoumsatz.",
    sources: ["Rahmenplan §3 GuV-Gliederung", "Lernkurs · Kapitel 4 · Erlösarten"],
  },
  {
    id: "p2",
    label: "Wie unterscheidet sich Skonto von Rabatt?",
    answer:
      "Rabatt ist eine sofortige Preisminderung beim Verkauf. Skonto ist ein nachträglicher Preisnachlass für schnelle Zahlung.",
    sources: ["Lernkurs · Kapitel 4 · Erlösarten", "MiniCheck Bilanzierung Q12"],
  },
];

export function AiTutorDemo() {
  const [active, setActive] = useState(PROMPTS[0]);

  return (
    <div
      className="rounded-2xl bg-surface-raised border border-border-subtle p-5 sm:p-6 shadow-elev-2"
      data-demo="ai-tutor"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
          Beispiel · KI-Tutor
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          Strict-RAG
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {PROMPTS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setActive(p)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
              active.id === p.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-surface text-text-secondary hover:border-primary"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 mb-3">
        <div className="flex items-start gap-2 mb-2">
          <Brain className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <p className="text-sm text-text-primary">{active.answer}</p>
        </div>
      </div>

      <div className="rounded-lg bg-surface-sunken p-3 text-xs">
        <div className="flex items-center gap-1 text-text-tertiary mb-1.5">
          <Quote className="h-3 w-3" />
          [SOURCES]
        </div>
        <ul className="space-y-1">
          {active.sources.map((s) => (
            <li key={s} className="text-text-secondary">· {s}</li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-text-tertiary mt-3">
        Antwort basiert auf Kursinhalt und Rahmenplan — keine freie KI.
      </p>
    </div>
  );
}
