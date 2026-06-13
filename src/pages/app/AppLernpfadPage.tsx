import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Brain,
  ChevronRight,
  Quote,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Minus,
} from "lucide-react";
import "@/components/landing/v2/lp-v2-theme.css";
import { useSystemConsciousness } from "@/lib/system/SystemConsciousness";
import { useExamPsychology } from "@/lib/system/ExamPsychology";
import { DramaturgyChip } from "@/components/system/DramaturgyChip";
import { ExaminerLensCard } from "@/components/system/ExaminerLensCard";
import { ExaminerBiographyCard } from "@/components/system/ExaminerBiographyCard";
import { LearnerRecommendationStrip } from "@/components/recommendations/LearnerRecommendationStrip";
import { RecoveryPlanCard } from "@/components/recovery/RecoveryPlanCard";
import {
  useLearnerRealityBridge,
  type LearnerRealitySnapshot,
} from "@/hooks/useLearnerRealityBridge";

/**
 * /app/lernpfad — P0-3 Sprint 1: DB-gebundene Prüfungsstrategie.
 * Frage „Was sollte ich als Nächstes lernen?" → priorisierte Kompetenzen + nächster Schritt.
 */
export default function AppLernpfadPage() {
  const reality = useLearnerRealityBridge();

  return (
    <main className="lp-v2 min-h-screen w-full">
      <div className="relative mx-auto flex min-h-screen w-full max-w-[680px] flex-col px-5 pb-24 pt-8 sm:px-8 sm:pt-12">
        <BackgroundAura />
        <StrategyHeader />
        {reality.needsOnboarding ? (
          <LernpfadOnboarding />
        ) : reality.loading && !reality.hasData ? (
          <LernpfadLoading />
        ) : (
          <>
            <SystemStatusStrip />
            <div className="mb-3"><DramaturgyChip /></div>
            <div className="mb-3"><ExaminerLensCard /></div>
            <div className="mb-3"><ExaminerBiographyCard /></div>
            <TodayPriority reality={reality} />
            <StrategyTimeline />
            <CompetencyStates reality={reality} />
            <RecoveryPlanCard
              sourceEntityKind="app_lernpfad"
              sourceEntitySlug="lernpfad_recovery"
              limit={4}
            />
            <LearnerRecommendationStrip
              sourceEntityKind="app_lernpfad"
              sourceEntitySlug="lernpfad_strategy"
              limit={4}
            />
            <StrategistTutor />
            <RecalcStripe />
          </>
        )}
      </div>
    </main>
  );
}

function LernpfadOnboarding() {
  return (
    <section className="mt-8 rounded-2xl border border-white/[0.06] bg-[rgba(13,22,40,0.55)] p-6 text-center">
      <h2 className="lp-display text-xl text-[color:var(--lp-text-primary,#e8ecf3)]">
        Wähle deinen Beruf, um den Lernpfad zu starten
      </h2>
      <p className="mt-2 text-[14px] text-[color:var(--lp-text-secondary,#a8b3c2)]">
        Sobald ein Curriculum aktiv ist, priorisiert das System deine Kompetenzen.
      </p>
      <Link
        to="/berufe"
        className="mt-5 inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-medium"
        style={{
          background: "linear-gradient(180deg, rgba(46,211,183,0.16), rgba(46,211,183,0.08))",
          border: "1px solid rgba(46,211,183,0.35)",
          color: "rgb(46,211,183)",
        }}
      >
        Beruf wählen
        <ArrowRight className="h-4 w-4" />
      </Link>
    </section>
  );
}

function LernpfadLoading() {
  return (
    <div className="mt-8 space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-xl border border-white/[0.05] bg-white/[0.03]" />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Background & Header                                                 */
/* ------------------------------------------------------------------ */
function BackgroundAura() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px]"
      style={{
        background:
          "radial-gradient(60% 100% at 50% 0%, rgba(46,211,183,0.08) 0%, rgba(46,211,183,0) 70%)",
      }}
    />
  );
}

function StrategyHeader() {
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    const t = window.setInterval(() => {
      setPulse(true);
      window.setTimeout(() => setPulse(false), 1400);
    }, 26000);
    return () => clearInterval(t);
  }, []);

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
          Prüfungsstrategie
        </span>
      </div>
      <AnimatePresence>
        {pulse ? (
          <motion.div
            key="recalc"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-1.5 text-[11px]"
            style={{ color: "rgb(46,211,183)" }}
          >
            <RefreshCw className="h-3 w-3 animate-spin" />
            Strategie aktualisiert
          </motion.div>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--lp-text-tertiary,#7a8696)]">
            <Activity className="h-3 w-3" />
            <span>System beobachtet</span>
          </div>
        )}
      </AnimatePresence>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* 1. System-Status-Header                                             */
/* ------------------------------------------------------------------ */
function SystemStatusStrip() {
  const system = useSystemConsciousness();
  const items = system.topRisks(4).map((r) => ({
    tone: r.tone === "stable" ? ("ok" as const) : ("warn" as const),
    label: r.label,
  }));

  return (
    <div className="mb-5 -mx-1 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex gap-2 px-1">
        {items.map((it) => {
          const ok = it.tone === "ok";
          return (
            <div
              key={it.label}
              className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium"
              style={{
                background: ok ? "rgba(46,211,183,0.10)" : "rgba(255,184,108,0.10)",
                border: `1px solid ${ok ? "rgba(46,211,183,0.28)" : "rgba(255,184,108,0.30)"}`,
                color: ok ? "rgb(46,211,183)" : "rgb(255,184,108)",
              }}
            >
              {it.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Heutige Priorität — dominant, EIN Fokus                          */
/* ------------------------------------------------------------------ */
function TodayPriority({ reality }: { reality: LearnerRealitySnapshot }) {
  const { priority } = useExamPsychology();
  const top = reality.weak[0] ?? reality.partial[0];
  const focusTitle = top ? top.title : priority.focus;
  const focusReason = top
    ? `Aktueller Score ${Math.round(top.score)} / 100 in ${top.field || "diesem Lernfeld"} — hier liegt der größte Hebel.`
    : priority.reason;
  const isCritical = (top ? top.status === "weak" : priority.tone === "critical");
  const isWatch = (top ? top.status === "partial" : priority.tone === "watch");
  const badgeLabel = isCritical ? "Risiko hoch" : isWatch ? "Risiko beobachtet" : "Stabilisiert";
  const badgeColor = isCritical
    ? "rgb(232,150,150)"
    : isWatch
    ? "rgb(232,196,124)"
    : "rgb(120,220,196)";
  const badgeBg = isCritical
    ? "rgba(220,90,90,0.06)"
    : isWatch
    ? "rgba(212,168,96,0.06)"
    : "rgba(46,211,183,0.06)";
  const badgeBorder = isCritical
    ? "rgba(220,90,90,0.22)"
    : isWatch
    ? "rgba(212,168,96,0.22)"
    : "rgba(46,211,183,0.22)";

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--lp-text-tertiary,#7a8696)]">
          Heute priorisiert
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]"
          style={{ color: badgeColor, background: badgeBg, border: `1px solid ${badgeBorder}` }}
        >
          {badgeLabel}
        </span>
      </div>

      <div
        className="rounded-2xl p-5 sm:p-6"
        style={{
          background:
            "linear-gradient(180deg, rgba(13,22,40,0.72) 0%, rgba(13,22,40,0.55) 100%)",
          border: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "0 1px 0 rgba(255,255,255,0.04) inset",
        }}
      >
        <div className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--lp-text-tertiary,#7a8696)]">
          Strategische Priorität · adaptiv
        </div>
        <h2 className="lp-display mt-1 text-[22px] leading-snug text-[color:var(--lp-text-primary,#e8ecf3)] sm:text-[24px]">
          {focusTitle}
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-[color:var(--lp-text-secondary,#a8b3c2)]">
          {focusReason}
        </p>

        <div className="mt-5 grid grid-cols-3 gap-2">
          {[
            { k: "Δ Prüfungsreife", v: priority.expectedImpact, tone: "ok" },
            { k: "Tone", v: isCritical ? "kritisch" : isWatch ? "beobachtet" : "stabil", tone: "neutral" },
            { k: "Empfohlen", v: "35 min", tone: "neutral" },
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
              <div
                className="mt-0.5 text-[13px]"
                style={{
                  color:
                    m.tone === "ok"
                      ? "rgb(46,211,183)"
                      : "var(--lp-text-primary,#e8ecf3)",
                }}
              >
                {m.v}
              </div>
            </div>
          ))}
        </div>

        <button
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition"
          style={{
            background:
              "linear-gradient(180deg, rgba(46,211,183,0.16) 0%, rgba(46,211,183,0.08) 100%)",
            border: "1px solid rgba(46,211,183,0.35)",
            color: "rgb(46,211,183)",
          }}
        >
          Einheit starten
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Dynamische Strategie-Zeitleiste                                  */
/* ------------------------------------------------------------------ */
type Stage = {
  phase: string;
  title: string;
  state: "active" | "next" | "later" | "recalc";
  tone: "warn" | "ok" | "neutral";
  note: string;
};

const STAGES: Stage[] = [
  {
    phase: "Jetzt",
    title: "Transferaufgaben stabilisieren",
    state: "active",
    tone: "warn",
    note: "Höchster erwarteter Punktverlust",
  },
  {
    phase: "Anschließend",
    title: "Rückfragen-Risiko reduzieren",
    state: "next",
    tone: "warn",
    note: "Mündliche Argumentation absichern",
  },
  {
    phase: "Vorgezogen",
    title: "Praxisargumentation absichern",
    state: "recalc",
    tone: "neutral",
    note: "Strategie heute angepasst",
  },
  {
    phase: "Diese Woche",
    title: "LF3 — Zeitdruck-Simulation",
    state: "later",
    tone: "neutral",
    note: "Stabilisierung unter Bedingungen",
  },
  {
    phase: "Vor Prüfung",
    title: "Fachgesprächs-Vollsimulation",
    state: "later",
    tone: "ok",
    note: "Bereits stabilisierte Domäne",
  },
];

function StrategyTimeline() {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--lp-text-tertiary,#7a8696)]">
          Adaptive Strategie
        </span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--lp-text-tertiary,#7a8696)]">
          recalc · vor 2 min
        </span>
      </div>

      <ol className="relative">
        <div
          aria-hidden
          className="absolute left-[7px] top-1 bottom-1 w-px"
          style={{ background: "rgba(255,255,255,0.06)" }}
        />
        {STAGES.map((s, i) => (
          <li key={s.title} className="relative pb-3 pl-6">
            <StageDot stage={s} />
            <div className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--lp-text-tertiary,#7a8696)]">
              {s.phase}
              {s.state === "recalc" && (
                <span
                  className="ml-2 rounded-full px-1.5 py-[1px] text-[9px]"
                  style={{
                    color: "rgb(46,211,183)",
                    background: "rgba(46,211,183,0.08)",
                    border: "1px solid rgba(46,211,183,0.24)",
                  }}
                >
                  vorgezogen
                </span>
              )}
            </div>
            <div
              className="mt-0.5 text-[14px]"
              style={{
                color:
                  s.state === "active" || s.state === "next"
                    ? "var(--lp-text-primary,#e8ecf3)"
                    : "var(--lp-text-secondary,#a8b3c2)",
              }}
            >
              {s.title}
            </div>
            <div className="text-[12px] text-[color:var(--lp-text-tertiary,#7a8696)]">
              {s.note}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function StageDot({ stage }: { stage: Stage }) {
  const color =
    stage.state === "active"
      ? "rgb(46,211,183)"
      : stage.state === "recalc"
      ? "rgb(46,211,183)"
      : stage.tone === "warn"
      ? "rgb(255,184,108)"
      : "rgba(170,190,220,0.45)";
  return (
    <div className="absolute left-0 top-[5px]">
      {stage.state === "active" ? (
        <motion.div
          className="h-[15px] w-[15px] rounded-full"
          style={{
            background: color,
            boxShadow: "0 0 0 4px rgba(46,211,183,0.12)",
          }}
          animate={{ boxShadow: [
            "0 0 0 4px rgba(46,211,183,0.10)",
            "0 0 0 7px rgba(46,211,183,0.04)",
            "0 0 0 4px rgba(46,211,183,0.10)",
          ] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : (
        <div
          className="h-[11px] w-[11px] rounded-full"
          style={{
            background:
              stage.state === "next" || stage.state === "recalc"
                ? color
                : "transparent",
            border: `1.5px solid ${color}`,
            marginLeft: 2,
            marginTop: 2,
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Kompetenz-Zustände — keine Prozent, nur Zustand                  */
/* ------------------------------------------------------------------ */
type CompetencyState =
  | "kritisch"
  | "instabil"
  | "stabilisiert"
  | "prüfungsreif"
  | "rückläufig"
  | "verbessert";

const COMPS: Array<{
  area: string;
  title: string;
  state: CompetencyState;
  trend: "up" | "down" | "flat";
  memory: string;
}> = [
  {
    area: "LF5",
    title: "Transferaufgaben",
    state: "kritisch",
    trend: "flat",
    memory: "seit 6 Tagen priorisiert",
  },
  {
    area: "LF7",
    title: "Mündliche Argumentation",
    state: "instabil",
    trend: "up",
    memory: "zuletzt verbessert",
  },
  {
    area: "LF3",
    title: "Zeitdruck-Aufgaben",
    state: "verbessert",
    trend: "up",
    memory: "Risiko gesunken",
  },
  {
    area: "LF2",
    title: "Praxisbezug",
    state: "stabilisiert",
    trend: "flat",
    memory: "stabil seit 9 Tagen",
  },
  {
    area: "LF6",
    title: "Bewertungslogik",
    state: "prüfungsreif",
    trend: "flat",
    memory: "konstant geprüft",
  },
];

const STATE_TONE: Record<CompetencyState, { color: string; bg: string; border: string }> = {
  kritisch: {
    color: "rgb(232,150,150)",
    bg: "rgba(220,90,90,0.06)",
    border: "rgba(220,90,90,0.22)",
  },
  instabil: {
    color: "rgb(255,184,108)",
    bg: "rgba(255,184,108,0.06)",
    border: "rgba(255,184,108,0.24)",
  },
  rückläufig: {
    color: "rgb(255,184,108)",
    bg: "rgba(255,184,108,0.06)",
    border: "rgba(255,184,108,0.24)",
  },
  stabilisiert: {
    color: "rgb(46,211,183)",
    bg: "rgba(46,211,183,0.06)",
    border: "rgba(46,211,183,0.22)",
  },
  verbessert: {
    color: "rgb(46,211,183)",
    bg: "rgba(46,211,183,0.06)",
    border: "rgba(46,211,183,0.22)",
  },
  prüfungsreif: {
    color: "rgb(46,211,183)",
    bg: "rgba(46,211,183,0.06)",
    border: "rgba(46,211,183,0.22)",
  },
};

function CompetencyStates() {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--lp-text-tertiary,#7a8696)]">
          Beobachtete Kompetenzen
        </span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--lp-text-tertiary,#7a8696)]">
          Top 5 · risikogewichtet
        </span>
      </div>
      <ul className="space-y-2">
        {COMPS.map((c) => {
          const tone = STATE_TONE[c.state];
          return (
            <li
              key={c.title}
              className="flex items-center gap-3 rounded-xl px-3 py-3"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--lp-text-tertiary,#7a8696)]">
                  {c.area}
                </div>
                <div className="truncate text-[14px] text-[color:var(--lp-text-primary,#e8ecf3)]">
                  {c.title}
                </div>
                <div className="text-[11px] text-[color:var(--lp-text-tertiary,#7a8696)]">
                  {c.memory}
                </div>
              </div>
              <TrendArrow trend={c.trend} />
              <div
                className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium"
                style={{
                  color: tone.color,
                  background: tone.bg,
                  border: `1px solid ${tone.border}`,
                }}
              >
                {c.state}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TrendArrow({ trend }: { trend: "up" | "down" | "flat" }) {
  if (trend === "up")
    return <TrendingUp className="h-3.5 w-3.5" style={{ color: "rgb(46,211,183)" }} />;
  if (trend === "down")
    return <TrendingDown className="h-3.5 w-3.5" style={{ color: "rgb(232,150,150)" }} />;
  return <Minus className="h-3.5 w-3.5" style={{ color: "rgba(170,190,220,0.5)" }} />;
}

/* ------------------------------------------------------------------ */
/* 5. Strategist-Tutor                                                 */
/* ------------------------------------------------------------------ */
function StrategistTutor() {
  return (
    <section className="mb-6">
      <div
        className="rounded-2xl p-4 sm:p-5"
        style={{
          background:
            "linear-gradient(180deg, rgba(13,22,40,0.55) 0%, rgba(13,22,40,0.40) 100%)",
          border: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4" style={{ color: "rgb(46,211,183)" }} />
          <span className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--lp-text-tertiary,#7a8696)]">
            Strategie-Tutor · 4 Sessions analysiert
          </span>
        </div>

        <div className="mt-3 space-y-2.5">
          <p className="flex gap-2 text-[14px] leading-relaxed text-[color:var(--lp-text-secondary,#a8b3c2)]">
            <Quote className="mt-1 h-3.5 w-3.5 shrink-0" style={{ color: "rgba(170,190,220,0.5)" }} />
            LF5 verursacht aktuell die meisten Punktverluste — deshalb zuerst.
          </p>
          <p className="flex gap-2 text-[14px] leading-relaxed text-[color:var(--lp-text-secondary,#a8b3c2)]">
            <Quote className="mt-1 h-3.5 w-3.5 shrink-0" style={{ color: "rgba(170,190,220,0.5)" }} />
            Die Reihenfolge wurde angepasst, um Transferaufgaben früher zu
            stabilisieren.
          </p>
          <p className="flex gap-2 text-[13px] leading-relaxed text-[color:var(--lp-text-tertiary,#7a8696)]">
            <Quote className="mt-1 h-3 w-3 shrink-0" style={{ color: "rgba(170,190,220,0.35)" }} />
            Mündliche Struktur ist stabiler als die schriftliche Argumentation —
            Fokus bleibt schriftlich.
          </p>
        </div>

        <Link
          to="/app/oral"
          className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-medium"
          style={{ color: "rgb(46,211,183)" }}
        >
          Strategie im Fachgespräch fortsetzen
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 6. Recalc-Stripe — stille Systemaktivität                           */
/* ------------------------------------------------------------------ */
function RecalcStripe() {
  const system = useSystemConsciousness();
  const fallback = [
    { label: "Priorisierung angepasst" },
    { label: "mündliche Vorbereitung vorgezogen" },
    { label: "LF3 Risiko gesunken" },
  ];
  const items = system.memory.slice(0, 3).length > 0
    ? system.memory.slice(0, 3).map((m) => ({ label: m.text }))
    : fallback;
  return (
    <section className="mt-2">
      <div className="mb-2 text-[11px] uppercase tracking-[0.14em] text-[color:var(--lp-text-tertiary,#7a8696)]">
        Letzte System-Updates
        {system.lastRecalc && (
          <span className="ml-2 normal-case tracking-normal text-[color:var(--lp-text-secondary,#a8b3c2)]">
            · {system.lastRecalc.message}
          </span>
        )}
      </div>
      <ul className="space-y-1.5">
        {items.map(({ label }, i) => {
          const Icon = i === 0 ? Sparkles : i === 1 ? Target : AlertTriangle;
          return (
            <li
              key={label}
              className="flex items-center gap-2 text-[12px] text-[color:var(--lp-text-secondary,#a8b3c2)]"
            >
              <Icon className="h-3 w-3" style={{ color: "rgba(46,211,183,0.7)" }} />
              <span>{label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
