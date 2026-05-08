import { Button } from "@/components/ui/button";
import { ArrowRight, ShieldCheck, Clock, Sparkles } from "lucide-react";
import { HeroAccent } from "@/components/marketing/HeroAccent";

interface Props {
  contextLabel?: string | null;
  onStart: () => void;
}

export function QuizStartScreen({ contextLabel, onStart }: Props) {
  return (
    <div className="rounded-2xl p-6 sm:p-10 bg-surface-raised border border-border-subtle shadow-elev-2">
      {contextLabel && (
        <div className="inline-flex items-center gap-2 mb-4 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
          <Sparkles className="h-3.5 w-3.5" />
          Check für: {contextLabel}
        </div>
      )}
      <h1 className="text-2xl sm:text-4xl font-bold text-text-primary leading-tight mb-3">
        Teste kostenlos deine Prüfungsreife in 4&nbsp;Minuten.
      </h1>
      <p className="text-base text-text-secondary mb-6">
        Beantworte kurze Fragen zu Vorbereitung, Sicherheit und Prüfungsformat. Danach erhältst du
        deinen Score, deine größten Risiken und eine konkrete Empfehlung.
      </p>

      <Button
        variant="petrol"
        size="xl"
        className="w-full sm:w-auto rounded-xl group focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        onClick={onStart}
        data-testid="quiz-start"
      >
        Check starten
        <ArrowRight className="h-5 w-5 ml-1 group-hover:translate-x-1 transition-transform" />
      </Button>

      <ul className="mt-6 grid gap-3 sm:grid-cols-3 text-sm text-text-secondary">
        <li className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-success" />
          Kostenlos
        </li>
        <li className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-success" />
          Ohne Anmeldung
        </li>
        <li className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-success" />
          Sofortige Auswertung
        </li>
      </ul>
    </div>
  );
}
