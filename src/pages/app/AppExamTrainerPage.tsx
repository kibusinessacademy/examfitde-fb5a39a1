import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Brain, Cpu, Gauge, MessageCircle, Radar, ShieldAlert, Sparkles, Timer, Waves } from "lucide-react";
import { useSystemConsciousness } from "@/lib/system/SystemConsciousness";
import {
  useExamDramaturgy,
  shouldRecalcDramaturgy,
  dramaturgyRecalcMessage,
  type DramaturgyPhase,
} from "@/lib/system/ExamDramaturgy";
import { DramaturgyInline } from "@/components/system/DramaturgyChip";
import { ExaminerLensCard } from "@/components/system/ExaminerLensCard";
import { ExaminerBiographyCard } from "@/components/system/ExaminerBiographyCard";
import { LearnerRecommendationStrip } from "@/components/recommendations/LearnerRecommendationStrip";
import { AdaptiveExamPlanCard } from "@/components/exam/AdaptiveExamPlanCard";
import { useAdaptiveExamPlan } from "@/hooks/useAdaptiveExamPlan";

/**
 * Phase 5.7 — Exam-Trainer als simulierte Prüfungssituation.
 * Diese Surface ist KEIN Quiz: sie misst Verhalten unter Prüfungsbedingungen
 * (Zeitdruck als Diagnostik, Stabilität, Antwortstruktur) und übersetzt
 * Antworten in Prüfungszustände — nicht in Punkte.
 */

type RiskTone = "critical" | "watch" | "stable";
type Phase = "pre" | "exam" | "deliberation" | "result";

interface ExamItem {
  id: string;
  domain: string;
  prompt: string;
  examinerLens: string;
  expected: "structured" | "transfer" | "valuation";
  timePressureWeight: number; // 0..1
}

const EXAM: ExamItem[] = [
  {
    id: "lf5-a",
    domain: "LF5 · Bewertung",
    prompt:
      "Begründen Sie den Wertansatz einer halbfertigen Leistung am Bilanzstichtag — strukturiert, mit Bezug auf das Vorsichtsprinzip.",
    examinerLens: "Ein Prüfer würde hier nach der Reihenfolge der Argumentation fragen.",
    expected: "valuation",
    timePressureWeight: 0.9,
  },
  {
    id: "transfer-b",
    domain: "Transfer · Praxisbezug",
    prompt:
      "Übertragen Sie die Bewertungslogik auf einen Auftrag mit unklarer Fertigstellungsgrad-Schätzung.",
    examinerLens: "Belastbarkeit der Begründung wird hier diagnostisch beobachtet.",
    expected: "transfer",
    timePressureWeight: 0.7,
  },
  {
    id: "lf3-c",
    domain: "LF3 · Struktur",
    prompt:
      "Skizzieren Sie die Antwortstruktur für eine 4-Punkte-Frage zur Buchungslogik (Reihenfolge zählt).",
    examinerLens: "Antwortstruktur entscheidet hier mehr als der Inhalt.",
    expected: "structured",
    timePressureWeight: 0.5,
  },
];

function toneClasses(tone: RiskTone) {
  if (tone === "critical") return "border-destructive/30 bg-destructive/5 text-destructive";
  if (tone === "watch") return "border-primary/30 bg-primary/5 text-primary";
  return "border-emerald-400/30 bg-emerald-400/5 text-emerald-500 dark:text-emerald-300";
}

const BackgroundAura = ({ tone }: { tone: RiskTone }) => {
  const gradient =
    tone === "critical"
      ? "radial-gradient(60% 60% at 50% 0%, rgba(232,150,150,0.10), transparent 70%)"
      : tone === "watch"
      ? "radial-gradient(60% 60% at 50% 0%, rgba(255,210,120,0.08), transparent 70%)"
      : "radial-gradient(60% 60% at 50% 0%, rgba(46,211,183,0.10), transparent 70%)";
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ background: gradient, transition: "background 1.2s ease" }}
    />
  );
};

const SystemStrip = ({ note }: { note: string }) => (
  <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur">
    <Radar className="h-3.5 w-3.5 animate-pulse" aria-hidden />
    <span className="font-medium tracking-wide">{note}</span>
  </div>
);

const RiskChip = ({ tone, label }: { tone: RiskTone; label: string }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${toneClasses(
      tone,
    )}`}
  >
    <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
    {label}
  </span>
);

const SectionTitle = ({ icon: Icon, eyebrow, title }: { icon: any; eyebrow: string; title: string }) => (
  <div className="mb-3 flex items-center gap-2">
    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-card/60 text-muted-foreground">
      <Icon className="h-3.5 w-3.5" aria-hidden />
    </span>
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">{eyebrow}</div>
      <div className="text-sm font-semibold text-foreground">{title}</div>
    </div>
  </div>
);

export default function AppExamTrainerPage() {
  const { recalc, remember, updateRisk, setReadiness, readiness, recordSignal } = useSystemConsciousness();
  const [phase, setPhase] = useState<Phase>("pre");
  const [idx, setIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0); // sec since exam start
  const [answer, setAnswer] = useState("");
  const [stability, setStability] = useState(72); // 0..100 — ruhige Diagnostik
  const [pressureSignal, setPressureSignal] = useState<string | null>(null);
  const [memory, setMemory] = useState<string[]>([
    "3 Prüfungen analysiert",
    "Zeitdruck-Stabilität zuletzt leicht verbessert",
    "LF5 weiterhin kritisch",
  ]);

  const current = EXAM[idx];
  const tone: RiskTone = stability < 55 ? "critical" : stability < 75 ? "watch" : "stable";

  // Phase 6.1 — Dramaturgie (elapsedRatio basiert auf idx/EXAM-Länge + Zeit)
  const elapsedRatio = phase === "exam" ? Math.min(1, (idx + Math.min(1, elapsed / 90)) / EXAM.length) : 0;
  const dramaturgy = useExamDramaturgy(elapsedRatio);
  const prevPhaseRef = useRef<DramaturgyPhase | null>(null);
  const followupIntervention = dramaturgy.interventions.find((i) => i.key === "deepen_followup");

  // P-Completion 3 — adaptive exam plan (deterministic preview over a
  // demo blueprint until the real per-curriculum blueprint is wired in).
  const adaptivePlan = useAdaptiveExamPlan({
    totalQuestions: EXAM.length * 4, // demo: 12 slots
    difficultyDistribution: { easy: 4, medium: 6, hard: 2 },
    weights: [
      { competency_id: "k_struct", competency_key: "LF3.struct", weight: 0.35 },
      { competency_id: "k_transfer", competency_key: "LF·transfer", weight: 0.35 },
      { competency_id: "k_valuation", competency_key: "LF5.valuation", weight: 0.30 },
    ],
  });

  // ruhiger Sekunden-Tick im Exam
  useEffect(() => {
    if (phase !== "exam") return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Phase 6.1 — Dramaturgie-Recalc nur bei echtem Phasenwechsel
  useEffect(() => {
    const next = dramaturgy.phase.phase;
    if (shouldRecalcDramaturgy(prevPhaseRef.current, next)) {
      recalc(dramaturgyRecalcMessage(next));
      remember(`Dramaturgie: ${dramaturgy.phase.label}`, "Exam-Trainer",
        next === "transfer_stress" ? "critical" : next === "load_increase" || next === "uncertainty_probe" ? "watch" : "stable");
    }
    prevPhaseRef.current = next;
  }, [dramaturgy.phase.phase, dramaturgy.phase.label, recalc, remember]);

  // Zeitdruck-Diagnostik: stille Signale, kein Countdown
  useEffect(() => {
    if (phase !== "exam") return;
    if (elapsed > 0 && elapsed % 25 === 0) {
      const pool = [
        "Argumentationsqualität unter Zeitdruck rückläufig",
        "Unsicherheit bei Bewertungsaufgaben gestiegen",
        "Transferstabilität sinkt unter Belastung",
        "Antworttempo wirkt ruhig — Stabilität gehalten",
      ];
      setPressureSignal(pool[(elapsed / 25) % pool.length]);
      setStability((v) => Math.max(40, v - Math.round(current.timePressureWeight * 3)));
      // Phase 6 — kontinuierlicher Zeitdruck-Signal-Buildup
      const pressure = Math.min(1, elapsed / 90 * current.timePressureWeight);
      recordSignal("timePressure", pressure, 0.25);
    }
  }, [elapsed, phase, current.timePressureWeight, recordSignal]);

  const examinerToneNote = useMemo(() => {
    if (tone === "critical") return "Ein Prüfer würde hier vermutlich nachhaken.";
    if (tone === "watch") return "Strukturell tragfähig, aber unter Belastung instabil.";
    return "Antwortverhalten wirkt prüfungsnah stabil.";
  }, [tone]);

  function startExam() {
    setPhase("exam");
    setElapsed(0);
    setPressureSignal("Prüfungszustand aktualisiert");
    setStability(72);
    recalc("Prüfungszustand aktualisiert");
  }

  function submitAnswer(quality: "weak" | "partial" | "strong") {
    setPhase("deliberation");
    const delta = quality === "strong" ? +6 : quality === "partial" ? -2 : -10;
    const next = Math.max(20, Math.min(95, stability + delta));
    // stille Re-Evaluation
    setTimeout(() => {
      setStability(next);
      const verdict =
        quality === "strong"
          ? "Transferargumentation verbessert"
          : quality === "partial"
          ? "Fachlich stabil, aber strukturell unsicher"
          : "Zeitdruck erhöht Punktverluste";
      setMemory((m) => [verdict, ...m].slice(0, 5));

      // Cross-Surface: gemeinsames Bewusstsein aktualisieren
      const globalTone = next < 55 ? "critical" : next < 75 ? "watch" : "stable";
      updateRisk("transfer_argumentation", {
        label:
          quality === "strong"
            ? "Transferargumentation verbessert"
            : "Transferargumentation instabil",
        tone: quality === "strong" ? "watch" : "critical",
      });
      updateRisk("zeitdruck_relevant", {
        label:
          quality === "weak"
            ? "Zeitdruck-Risiko erhöht"
            : "Zeitdruck-Risiko relevant",
        tone: quality === "weak" ? "critical" : "watch",
      });
      setReadiness(Math.round(readiness * 0.7 + next * 0.3));
      remember(verdict, "Exam-Trainer", globalTone);
      // Phase 6 — Behavioral Signals aus Antwortqualität + Bearbeitungsdauer
      recordSignal(
        "structureStability",
        quality === "strong" ? 0.8 : quality === "partial" ? 0.55 : 0.3,
        0.4,
      );
      recordSignal(
        "confidence",
        quality === "strong" ? 0.8 : quality === "partial" ? 0.5 : 0.3,
        0.4,
      );
      recordSignal(
        "hesitation",
        Math.min(1, Math.max(0, (elapsed - 30) / 60)),
        0.3,
      );

      if (idx + 1 < EXAM.length) {
        setIdx((i) => i + 1);
        setAnswer("");
        setPressureSignal("Strategie recalculated");
        setPhase("exam");
        recalc("Strategie angepasst");
      } else {
        setPhase("result");
        recalc("Transferrisiko neu bewertet");
      }
    }, 1600);
  }

  function resetExam() {
    setPhase("pre");
    setIdx(0);
    setAnswer("");
    setElapsed(0);
    setStability(72);
    setPressureSignal(null);
  }

  return (
    <main className="relative min-h-screen bg-background text-foreground">
      <BackgroundAura tone={tone} />

      <div className="relative mx-auto w-full max-w-2xl px-4 pt-6 pb-24 sm:pt-10">
        {/* HEADER — Prüfungsmodus, kein App-Header */}
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-card/70">
              <Cpu className="h-4 w-4 text-muted-foreground" aria-hidden />
            </span>
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Exam-Trainer · Prüfungsmodus
              </div>
              <h1 className="text-base font-semibold leading-tight">Simulierte Prüfungssituation</h1>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <DramaturgyInline elapsedRatio={elapsedRatio} />
            <SystemStrip note={pressureSignal ?? "Zustand stabil beobachtet"} />
          </div>
        </header>

        {/* Phase 7.0 — Examiner-Lens: konsistente prüferische Wahrheit, surface-übergreifend */}
        <ExaminerLensCard elapsedRatio={elapsedRatio} className="mb-5" />
        <ExaminerBiographyCard elapsedRatio={elapsedRatio} className="mb-5" />



        {/* PRE-EXAM */}
        {phase === "pre" && (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="rounded-2xl border border-border/60 bg-card/60 p-5 backdrop-blur"
          >
            <SectionTitle icon={ShieldAlert} eyebrow="Pre-Exam · Diagnostik" title="Diese Prüfung wurde bewusst zusammengestellt" />
            <p className="text-sm text-muted-foreground">
              Auf Basis Ihrer letzten Stabilitätsbewertungen wurden 3 belastungsrelevante Aufgaben gewählt.
              Der Fokus liegt nicht auf Wissensabfrage, sondern auf Ihrer Stabilität unter Prüfungsbedingungen.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <RiskChip tone="critical" label="Transferaufgaben unter Zeitdruck kritisch" />
              <RiskChip tone="watch" label="LF5 verursacht Punktverluste" />
              <RiskChip tone="stable" label="Antwortstruktur zuletzt stabiler" />
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              {EXAM.map((q, i) => (
                <div
                  key={q.id}
                  className="rounded-xl border border-border/60 bg-background/40 p-3 text-xs text-muted-foreground"
                >
                  <div className="text-[10px] uppercase tracking-wider">Aufgabe {i + 1}</div>
                  <div className="mt-1 font-medium text-foreground">{q.domain}</div>
                </div>
              ))}
            </div>

            <button
              onClick={startExam}
              className="mt-6 w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-95"
            >
              Prüfungsmodus aktivieren
            </button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Stille Diagnostik · Zeitdruck als Beobachtungsfaktor
            </p>

            <LearnerRecommendationStrip
              sourceEntityKind="app_exam_trainer"
              sourceEntitySlug="exam_pre"
              examForm="schriftlich"
              limit={3}
            />
          </motion.section>
        )}

        {/* EXAM FLOW */}
        {phase === "exam" && (
          <motion.section
            key={current.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="rounded-2xl border border-border/60 bg-card/60 p-5 backdrop-blur"
          >
            <div className="mb-3 flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" aria-hidden />
                {current.domain}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Timer className="h-3.5 w-3.5" aria-hidden />
                {Math.floor(elapsed / 60)
                  .toString()
                  .padStart(2, "0")}
                :{(elapsed % 60).toString().padStart(2, "0")}
              </span>
            </div>

            <h2 className="text-base font-semibold leading-snug text-foreground">{current.prompt}</h2>
            <p className="mt-2 text-xs italic text-muted-foreground">{current.examinerLens}</p>

            {/* Phase 6.1 — Adaptive Rückfragen-Intervention (nur bei echter Belastung sichtbar) */}
            <AnimatePresence>
              {followupIntervention?.prompt && (
                <motion.div
                  key={followupIntervention.prompt}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                  className="mt-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary"
                  role="note"
                  aria-label="Rückfrage des Prüfers"
                >
                  <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] opacity-80">
                    <MessageCircle className="h-3 w-3" aria-hidden />
                    Rückfrage
                  </span>
                  <p className="mt-1 text-foreground">{followupIntervention.prompt}</p>
                  <p className="mt-1 text-[11px] opacity-70">{followupIntervention.rationale}</p>
                </motion.div>
              )}
            </AnimatePresence>

            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Antwort strukturieren — Begründung vor Ergebnis"
              className="mt-4 h-32 w-full resize-none rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />

            {/* Stille Zeitdruck-Diagnostik */}
            <AnimatePresence>
              {pressureSignal && (
                <motion.div
                  key={pressureSignal + elapsed}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground"
                >
                  <Waves className="h-3.5 w-3.5" aria-hidden />
                  <span>{pressureSignal}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <button
                onClick={() => submitAnswer("weak")}
                className="rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-xs font-medium text-foreground hover:bg-background/70"
              >
                Antwort abgeben · unsicher
              </button>
              <button
                onClick={() => submitAnswer("partial")}
                className="rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-xs font-medium text-foreground hover:bg-background/70"
              >
                Antwort abgeben · teilweise
              </button>
              <button
                onClick={() => submitAnswer("strong")}
                className="rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-95"
              >
                Antwort abgeben · belastbar
              </button>
            </div>

            <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Aufgabe {idx + 1} von {EXAM.length}</span>
              <RiskChip
                tone={tone}
                label={
                  tone === "critical"
                    ? "Stabilität rückläufig"
                    : tone === "watch"
                    ? "Stabilität beobachtet"
                    : "Stabilität gehalten"
                }
              />
            </div>
          </motion.section>
        )}

        {/* DELIBERATION */}
        {phase === "deliberation" && (
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-2xl border border-border/60 bg-card/60 p-8 text-center backdrop-blur"
          >
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-background/50">
              <Brain className="h-4 w-4 animate-pulse text-muted-foreground" aria-hidden />
            </div>
            <p className="mt-4 text-sm font-medium text-foreground">Antwort wird bewertet…</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Stille Re-Evaluation · Prüfungszustand wird angepasst
            </p>
          </motion.section>
        )}

        {/* RESULT — Zustandsupdate, keine Statistik */}
        {phase === "result" && (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="rounded-2xl border border-border/60 bg-card/60 p-5 backdrop-blur"
          >
            <SectionTitle icon={Gauge} eyebrow="Prüfungsergebnis · Zustandsupdate" title="Diagnostische Prüfungsbewertung" />
            <p className="text-sm text-muted-foreground">{examinerToneNote}</p>

            <div className="mt-4 space-y-2">
              <RiskChip
                tone={tone}
                label={
                  tone === "critical"
                    ? "Prüfungsreife belastet — Zeitdruck weiterhin relevant"
                    : tone === "watch"
                    ? "Prüfungsreife leicht stabilisiert"
                    : "Prüfungsreife unter Druck belastbar"
                }
              />
              <RiskChip tone="watch" label="Rückfragen-Risiko weiterhin spürbar" />
              <RiskChip tone="critical" label="LF5 strukturell unsicher" />
            </div>

            {/* Tutor-Analyse */}
            <div className="mt-5 rounded-xl border border-border/60 bg-background/40 p-4">
              <SectionTitle icon={Sparkles} eyebrow="Tutor · Prüfungsanalyse" title="Diagnostische Einordnung" />
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                <li>· Unter Zeitdruck wurde die Argumentation deutlich unsicherer.</li>
                <li>· Die Antwort war fachlich korrekt, aber nicht belastbar genug.</li>
                <li>· Die Transferlogik bleibt instabil.</li>
              </ul>
            </div>

            {/* System Memory */}
            <div className="mt-5">
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">
                System-Memory · Exam-Trainer
              </div>
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                {memory.map((m, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1 h-1 w-1 rounded-full bg-muted-foreground/60" aria-hidden />
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            </div>

            <button
              onClick={resetExam}
              className="mt-6 w-full rounded-xl border border-border/60 bg-background/40 px-4 py-3 text-sm font-medium text-foreground hover:bg-background/70"
            >
              Neue Prüfungssimulation vorbereiten
            </button>
          </motion.section>
        )}
      </div>
    </main>
  );
}
