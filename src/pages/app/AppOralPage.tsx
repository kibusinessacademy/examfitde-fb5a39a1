import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  Quote,
  Activity,
  ShieldCheck,
  AlertTriangle,
  Brain,
  Mic,
  ChevronRight,
} from "lucide-react";
import "@/components/landing/v2/lp-v2-theme.css";
import {
  useSystemConsciousness,
  riskToneClasses,
  daysSince,
  type RiskTone,
} from "@/lib/system/SystemConsciousness";


/**
 * /app/oral — Phase 5.2: Diagnostische Fachgesprächs-Simulation
 *
 * Pure presentation layer. Keine Businesslogik, keine Persistenz.
 * Ziel: glaubwürdige IHK-Fachgesprächssituation statt Voice-AI-Showcase.
 *
 * Phasen: pre → question → speaking → deliberation → reveal → debrief
 * Identitäts-Tokens aus lp-v2-theme (Petrol/Aqua, gedämpftes Rot, Stille).
 */
type Phase = "pre" | "question" | "speaking" | "deliberation" | "reveal" | "debrief";

const QUESTION = {
  area: "Kosten- und Leistungsrechnung",
  competency: "Voll- vs. Teilkostenrechnung",
  weight: "Transfer · Praxisbegründung",
  prompt:
    "Ein Kunde widerspricht Ihrer Kalkulation und verlangt einen Nachlass. Wie würden Sie das im Betrieb begründen — auf Voll- oder Teilkostenbasis?",
};

export default function AppOralPage() {
  return (
    <main className="lp-v2 min-h-screen w-full">
      <div className="relative mx-auto flex min-h-screen w-full max-w-[680px] flex-col px-5 pb-24 pt-8 sm:px-8 sm:pt-12">
        <BackgroundAura />
        <OralHeader />
        <OralMemoryStrip />
        <SimulationStage />
        <DebriefStripe />
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Background & Header                                                 */
/* ------------------------------------------------------------------ */
function BackgroundAura() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px]"
        style={{
          background:
            "radial-gradient(60% 100% at 50% 0%, rgba(46,211,183,0.08) 0%, rgba(46,211,183,0) 70%)",
        }}
      />
    </>
  );
}

function OralHeader() {
  return (
    <header className="mb-6 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div
          className="flex h-7 w-7 items-center justify-center rounded-full"
          style={{
            background:
              "linear-gradient(135deg, rgba(46,211,183,0.18), rgba(46,211,183,0.04))",
            border: "1px solid rgba(46,211,183,0.28)",
          }}
        >
          <ShieldCheck className="h-3.5 w-3.5" style={{ color: "rgb(46,211,183)" }} />
        </div>
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--lp-text-tertiary,#7a8696)]">
          Fachgesprächs-Simulation
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--lp-text-tertiary,#7a8696)]">
        <Activity className="h-3 w-3" />
        <span>Prüfer aktiv</span>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* System Memory                                                       */
/* ------------------------------------------------------------------ */
function OralMemoryStrip() {
  const { topRisks } = useSystemConsciousness();
  const items = topRisks(4);
  if (items.length === 0) return null;

  return (
    <div className="mb-5 -mx-1 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex gap-2 px-1">
        {items.map((it) => (
          <div
            key={it.key}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-medium ${riskToneClasses(it.tone)}`}
          >
            <span className="opacity-90">{it.label}</span>
            <span className="ml-1.5 opacity-60">· seit {daysSince(it.since)}d</span>
          </div>
        ))}
      </div>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* Simulation Stage                                                    */
/* ------------------------------------------------------------------ */
function SimulationStage() {
  const [phase, setPhase] = useState<Phase>("pre");
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | null>(null);

  // Speaking timer
  useEffect(() => {
    if (phase === "speaking") {
      timerRef.current = window.setInterval(() => setElapsed((t) => t + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  // Auto-progress: deliberation → reveal
  useEffect(() => {
    if (phase === "deliberation") {
      const t = window.setTimeout(() => setPhase("reveal"), 3200);
      return () => clearTimeout(t);
    }
  }, [phase]);

  const reset = () => {
    setElapsed(0);
    setPhase("pre");
  };

  return (
    <section className="mb-6">
      <div
        className="lp-surface rounded-2xl p-5 sm:p-6"
        style={{
          background:
            "linear-gradient(180deg, rgba(13,22,40,0.72) 0%, rgba(13,22,40,0.55) 100%)",
          border: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "0 1px 0 rgba(255,255,255,0.04) inset",
        }}
      >
        {/* Frage-Kontext immer sichtbar */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--lp-text-tertiary,#7a8696)]">
              {QUESTION.area}
            </div>
            <div className="mt-0.5 truncate text-[13px] text-[color:var(--lp-text-secondary,#a8b3c2)]">
              {QUESTION.competency} · {QUESTION.weight}
            </div>
          </div>
          <PhasePill phase={phase} />
        </div>

        <AnimatePresence mode="wait">
          {phase === "pre" && <PreState key="pre" onStart={() => setPhase("question")} />}
          {phase === "question" && (
            <QuestionState key="question" onAnswer={() => setPhase("speaking")} />
          )}
          {phase === "speaking" && (
            <SpeakingState
              key="speaking"
              elapsed={elapsed}
              onStop={() => {
                setPhase("deliberation");
              }}
            />
          )}
          {phase === "deliberation" && <DeliberationState key="del" />}
          {phase === "reveal" && (
            <RevealState key="reveal" onContinue={() => setPhase("debrief")} />
          )}
          {phase === "debrief" && <DebriefState key="debrief" onRestart={reset} />}
        </AnimatePresence>
      </div>
    </section>
  );
}

function PhasePill({ phase }: { phase: Phase }) {
  const map: Record<Phase, { label: string; tone: "neutral" | "live" | "deliberate" | "done" }> = {
    pre: { label: "Vorbereitung", tone: "neutral" },
    question: { label: "Prüferfrage", tone: "neutral" },
    speaking: { label: "Antwort läuft", tone: "live" },
    deliberation: { label: "Prüfer analysiert", tone: "deliberate" },
    reveal: { label: "Bewertung", tone: "done" },
    debrief: { label: "Debriefing", tone: "done" },
  };
  const cfg = map[phase];
  const color =
    cfg.tone === "live"
      ? "rgb(46,211,183)"
      : cfg.tone === "deliberate"
      ? "rgb(170,190,220)"
      : cfg.tone === "done"
      ? "rgb(46,211,183)"
      : "rgb(140,155,178)";
  return (
    <div
      className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em]"
      style={{
        color,
        background: "rgba(255,255,255,0.03)",
        border: `1px solid ${color.replace("rgb", "rgba").replace(")", ",0.28)")}`,
      }}
    >
      {cfg.label}
    </div>
  );
}

/* ---------- Phase 1: Pre ---------- */
function PreState({ onStart }: { onStart: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <p className="text-[15px] leading-relaxed text-[color:var(--lp-text-secondary,#a8b3c2)]">
        Die nächste Frage stammt aus einem realistischen Fachgesprächs-Profil.
        Antworten werden nach Fachlichkeit, Struktur und Praxisbezug bewertet —
        nicht nach Auswendiglernen.
      </p>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {[
          { k: "Modus", v: "Fachgespräch" },
          { k: "Erwartet", v: "60–90 s" },
          { k: "Tiefe", v: "Transfer" },
        ].map((m) => (
          <div
            key={m.k}
            className="rounded-lg px-3 py-2"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <div className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--lp-text-tertiary,#7a8696)]">
              {m.k}
            </div>
            <div className="mt-0.5 text-[13px] text-[color:var(--lp-text-primary,#e8ecf3)]">
              {m.v}
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={onStart}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition"
        style={{
          background:
            "linear-gradient(180deg, rgba(46,211,183,0.16) 0%, rgba(46,211,183,0.08) 100%)",
          border: "1px solid rgba(46,211,183,0.35)",
          color: "rgb(46,211,183)",
        }}
      >
        Fachgespräch beginnen
        <ArrowRight className="h-4 w-4" />
      </button>
    </motion.div>
  );
}

/* ---------- Phase 2: Question ---------- */
function QuestionState({ onAnswer }: { onAnswer: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="flex gap-3">
        <Quote
          className="mt-1 h-5 w-5 shrink-0"
          style={{ color: "rgba(170,190,220,0.55)" }}
        />
        <p className="lp-display text-[19px] leading-snug text-[color:var(--lp-text-primary,#e8ecf3)] sm:text-[21px]">
          {QUESTION.prompt}
        </p>
      </div>
      <div className="mt-4 text-[12px] text-[color:var(--lp-text-tertiary,#7a8696)]">
        Der Prüfer wartet. Strukturieren Sie kurz, dann antworten Sie.
      </div>
      <button
        onClick={onAnswer}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.10)",
          color: "var(--lp-text-primary,#e8ecf3)",
        }}
      >
        <Mic className="h-4 w-4" style={{ color: "rgb(46,211,183)" }} />
        Antwort beginnen
      </button>
    </motion.div>
  );
}

/* ---------- Phase 3: Speaking ---------- */
function SpeakingState({ elapsed, onStop }: { elapsed: number; onStop: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <p className="text-[14px] leading-relaxed text-[color:var(--lp-text-secondary,#a8b3c2)]">
        {QUESTION.prompt}
      </p>

      <div className="mt-5 flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--lp-text-tertiary,#7a8696)]">
          Antwort wird analysiert
        </div>
        <div
          className="font-mono text-[12px]"
          style={{ color: "rgb(46,211,183)" }}
        >
          {formatTime(elapsed)}
        </div>
      </div>

      <Waveform active />

      <button
        onClick={onStop}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.10)",
          color: "var(--lp-text-primary,#e8ecf3)",
        }}
      >
        Antwort abschließen
      </button>
    </motion.div>
  );
}

/* ---------- Phase 4: Deliberation ---------- */
function DeliberationState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
    >
      <div className="py-4">
        <div className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--lp-text-tertiary,#7a8696)]">
          Prüfer analysiert Antwort
        </div>
        <Waveform active={false} fading />
        <div className="mt-3 flex items-center gap-2 text-[12px] text-[color:var(--lp-text-secondary,#a8b3c2)]">
          <motion.span
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          >
            … Struktur, Fachlichkeit und Praxisbezug werden gewichtet
          </motion.span>
        </div>
      </div>
    </motion.div>
  );
}

/* ---------- Phase 5: Reveal ---------- */
function RevealState({ onContinue }: { onContinue: () => void }) {
  const lines = [
    { label: "Fachlichkeit", state: "Fachlich korrekt, aber unsicher formuliert", tone: "warn" },
    { label: "Struktur", state: "Argumentationsstruktur instabil", tone: "warn" },
    { label: "Praxisbezug", state: "Praxisbezug stabil", tone: "ok" },
  ] as const;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      <ul className="space-y-3">
        {lines.map((l, i) => (
          <motion.li
            key={l.label}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 + i * 0.55, duration: 0.45 }}
            className="rounded-xl px-3 py-3"
            style={{
              background:
                l.tone === "ok" ? "rgba(46,211,183,0.06)" : "rgba(255,184,108,0.05)",
              border:
                l.tone === "ok"
                  ? "1px solid rgba(46,211,183,0.20)"
                  : "1px solid rgba(255,184,108,0.20)",
            }}
          >
            <div className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--lp-text-tertiary,#7a8696)]">
              {l.label}
            </div>
            <div
              className="mt-0.5 text-[14px]"
              style={{
                color:
                  l.tone === "ok" ? "rgb(46,211,183)" : "rgb(255,184,108)",
              }}
            >
              {l.state}
            </div>
          </motion.li>
        ))}
      </ul>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2.1, duration: 0.5 }}
        className="mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]"
        style={{
          background: "rgba(220,90,90,0.06)",
          border: "1px solid rgba(220,90,90,0.22)",
          color: "rgb(232,150,150)",
        }}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        Rückfragen wahrscheinlich · Transferargumentation zu allgemein
      </motion.div>

      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2.4 }}
        onClick={onContinue}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition"
        style={{
          background:
            "linear-gradient(180deg, rgba(46,211,183,0.16) 0%, rgba(46,211,183,0.08) 100%)",
          border: "1px solid rgba(46,211,183,0.35)",
          color: "rgb(46,211,183)",
        }}
      >
        Diagnostisches Debriefing
        <ChevronRight className="h-4 w-4" />
      </motion.button>
    </motion.div>
  );
}

/* ---------- Phase 6: Debrief ---------- */
function DebriefState({ onRestart }: { onRestart: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4" style={{ color: "rgb(46,211,183)" }} />
        <span className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--lp-text-tertiary,#7a8696)]">
          Tutor · 3 Fachgespräche analysiert
        </span>
      </div>

      <div className="mt-3 space-y-3">
        <DebriefLine>
          Die Fachbegriffe waren korrekt, aber die Begründung blieb zu allgemein.
        </DebriefLine>
        <DebriefLine>
          Ein Prüfer würde hier nach einem Praxisbeispiel aus dem Betrieb fragen.
        </DebriefLine>
        <DebriefLine subtle>
          Antwort war fachlich stabil, aber strukturell sprunghaft — Definition →
          Abgrenzung → Beispiel würde Sicherheit signalisieren.
        </DebriefLine>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <button
          onClick={onRestart}
          className="rounded-xl px-3 py-3 text-sm font-medium transition"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.10)",
            color: "var(--lp-text-primary,#e8ecf3)",
          }}
        >
          Nächste Frage
        </button>
        <Link
          to="/oral-exam"
          className="inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-3 text-sm font-medium transition"
          style={{
            background:
              "linear-gradient(180deg, rgba(46,211,183,0.16) 0%, rgba(46,211,183,0.08) 100%)",
            border: "1px solid rgba(46,211,183,0.35)",
            color: "rgb(46,211,183)",
          }}
        >
          Voll-Session starten
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </motion.div>
  );
}

function DebriefLine({
  children,
  subtle,
}: {
  children: React.ReactNode;
  subtle?: boolean;
}) {
  return (
    <p
      className="text-[14px] leading-relaxed"
      style={{
        color: subtle
          ? "var(--lp-text-tertiary,#7a8696)"
          : "var(--lp-text-secondary,#a8b3c2)",
      }}
    >
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Waveform — ruhig, kein Siri-Vibe                                    */
/* ------------------------------------------------------------------ */
function Waveform({ active, fading }: { active: boolean; fading?: boolean }) {
  const bars = 28;
  return (
    <div className="mt-4 flex h-12 items-end justify-between gap-[3px]">
      {Array.from({ length: bars }).map((_, i) => {
        const seed = ((i * 17) % 13) / 13; // deterministic
        const baseH = 8 + seed * 18;
        return (
          <motion.div
            key={i}
            className="w-[3px] rounded-full"
            style={{
              background: active
                ? "rgba(46,211,183,0.55)"
                : fading
                ? "rgba(170,190,220,0.28)"
                : "rgba(170,190,220,0.18)",
            }}
            animate={
              active
                ? { height: [baseH, baseH + 10 + seed * 14, baseH] }
                : fading
                ? { height: [baseH, 6] }
                : { height: baseH }
            }
            transition={{
              duration: active ? 1.1 + seed * 0.8 : 1.6,
              repeat: active ? Infinity : 0,
              ease: "easeInOut",
              delay: (i % 7) * 0.05,
            }}
          />
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Debrief Stripe                                                      */
/* ------------------------------------------------------------------ */
function DebriefStripe() {
  return (
    <section className="mt-2">
      <div className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--lp-text-tertiary,#7a8696)]">
        Mündlicher Zustand
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {[
          { k: "Letzte 7 Tage", v: "Mündlich instabil", tone: "warn" },
          { k: "Transferfragen", v: "Kritisch", tone: "warn" },
          { k: "Praxisbezug", v: "Stabil", tone: "ok" },
          { k: "Antwortstruktur", v: "Verbessert", tone: "ok" },
        ].map((m) => (
          <div
            key={m.k}
            className="rounded-xl px-3 py-3"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <div className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--lp-text-tertiary,#7a8696)]">
              {m.k}
            </div>
            <div
              className="mt-0.5 text-[13px]"
              style={{
                color: m.tone === "ok" ? "rgb(46,211,183)" : "rgb(255,184,108)",
              }}
            >
              {m.v}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
