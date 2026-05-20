import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/tracking/track";

const TARGET = 72;

export function ReadinessScoreDemo() {
  const [score, setScore] = useState(0);
  const [animated, setAnimated] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || animated) return;
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setAnimated(true);
          if (reduceMotion) {
            setScore(TARGET);
            return;
          }
          let v = 0;
          const id = setInterval(() => {
            v += 4;
            if (v >= TARGET) {
              setScore(TARGET);
              clearInterval(id);
            } else setScore(v);
          }, 35);
        }
      },
      { threshold: 0.4 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [animated]);

  return (
    <div
      ref={ref}
      className="rounded-2xl bg-surface-raised border border-border-subtle p-5 sm:p-6 shadow-elev-2"
      data-demo="readiness-score"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
          Beispiel · Readiness-Score
        </span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning-bg-subtle text-warning text-xs font-semibold border border-warning-border">
          Solide Basis
        </span>
      </div>

      <div className="flex items-end gap-2 mb-1">
        <span className="text-5xl font-bold text-text-primary tabular-nums">{score}</span>
        <span className="text-text-secondary mb-2">/ 100</span>
      </div>
      <div className="text-sm text-success flex items-center gap-1 mb-4">
        <ArrowUpRight className="h-4 w-4" />
        +8 % seit letzter Woche
      </div>

      <div className="h-2 rounded-full bg-surface-sunken overflow-hidden mb-4">
        <div
          className="h-full bg-primary transition-[width] duration-500"
          style={{ width: `${score}%` }}
        />
      </div>

      <div className="flex items-center gap-2 text-xs text-text-tertiary mb-5">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        Score basiert auf 8 Kompetenzen, Aufgaben­quote und Simulationsergebnis.
      </div>

      <Link
        to="/pruefungscheck"
        onClick={() =>
          trackEvent({
            eventName: "cta_click",
            metadata: { location: "demo_readiness_score", target: "/pruefungscheck" },
          })
        }
        className="block"
      >
        <Button variant="petrol" size="lg" className="w-full rounded-xl">
          <ShieldCheck className="h-4 w-4 mr-2" />
          Prüfungsreife testen
        </Button>
      </Link>
    </div>
  );
}
