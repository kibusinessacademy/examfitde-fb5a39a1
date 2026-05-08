import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, Brain, ClipboardCheck, MessagesSquare, Sparkles, Target, Timer } from "lucide-react";
import { PRICING } from "@/config/pricing";

const PRICE_DISPLAY = PRICING.defaultPrice;

interface Props {
  primaryHref: string;
  secondaryHref: string;
  onPrimary: () => void;
  onSecondary: () => void;
}

const FEATURES = [
  { icon: Target, label: "Lernplan aus deinen Schwächen" },
  { icon: ClipboardCheck, label: "MiniChecks pro Themengebiet" },
  { icon: Timer, label: "Schriftliche Simulation unter Zeitdruck" },
  { icon: MessagesSquare, label: "Mündliches Training mit Feedback" },
  { icon: Brain, label: "KI-Tutor mit Quellenangaben" },
];

export function ResultCtaBlock({ primaryHref, secondaryHref, onPrimary, onSecondary }: Props) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Was ExamFit jetzt für dich tut
        </h3>
        <ul className="grid gap-2 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-start gap-2 text-sm text-text-secondary">
              <Icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              {label}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-sm text-text-secondary">
        Du musst nicht mehr raten, was du lernen solltest. ExamFit priorisiert genau die Themen, die deine
        Prüfungsreife am stärksten verbessern.
      </p>

      <div className="flex flex-col gap-3">
        <Link to={primaryHref} onClick={onPrimary} className="block">
          <Button variant="petrol" size="xl" className="w-full rounded-xl group">
            Mit ExamFit gezielt vorbereiten – {PRICE_DISPLAY}
            <ArrowRight className="h-5 w-5 ml-1 group-hover:translate-x-1 transition-transform" />
          </Button>
        </Link>
        <Link to={secondaryHref} onClick={onSecondary} className="block">
          <Button variant="ghost" size="lg" className="w-full">
            Beruf wechseln
          </Button>
        </Link>
      </div>
    </div>
  );
}
