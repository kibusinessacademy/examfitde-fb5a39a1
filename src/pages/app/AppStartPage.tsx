import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  Activity,
  AlertTriangle,
  Sparkles,
  ChevronRight,
  Brain,
  ShieldCheck,
} from "lucide-react";
import "@/components/landing/v2/lp-v2-theme.css";

/**
 * /app/start — Continuity of Belief (Phase 4)
 *
 * Übergang Landingpage → Produkt. Kein Dashboard, keine Kachelwüste.
 * Diagnostische Fortsetzung der Reveal-Szene: Score lebt weiter,
 * ein priorisierter Schritt, ruhige Liveness. Mobile-first.
 */
export default function AppStartPage() {
  return (
    <main className="lp-v2 min-h-screen w-full">
      <div className="relative mx-auto flex min-h-screen w-full max-w-[680px] flex-col px-5 pb-24 pt-8 sm:px-8 sm:pt-12">
        <BackgroundAura />
        <SystemHeader />
        <DiagnosisHeadline />
        <ReadinessScore />
        <PriorityCompetency />
        <TutorWhisper />
        <SecondaryStripe />
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------- */
/* Background — single quiet aura, no motion noise                       */
/* -------------------------------------------------------------------- */
function BackgroundAura() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px]"
        style={{
          background:
            "radial-gradient(60% 100% at 50% 0%, rgba(46,211,183,0.10) 0%, rgba(46,211,183,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-20"
        style={{ background: "var(--lp-bg)" }}
      />
    </>
  );
}

/* -------------------------------------------------------------------- */
/* System Header — micro signal, keine Marketing-Sprache                */
/* -------------------------------------------------------------------- */
function SystemHeader() {
  return (
    <header className="mb-8 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--lp-emerald)", boxShadow: "0 0 8px var(--lp-emerald)" }}
        />
        <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--lp-text-3)]">
          ExamFit · System aktiv
        </span>
      </div>
      <span className="text-[11px] text-[var(--lp-text-3)] tabular-nums">
        Analyse · v2.4
      </span>
    </header>
  );
}

/* -------------------------------------------------------------------- */
/* Diagnose-Headline — Fortsetzung statt Begrüßung                      */
/* -------------------------------------------------------------------- */
function DiagnosisHeadline() {
  return (
    <section className="mb-10">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="lp-chip mb-5"
        style={{ background: "rgba(46,211,183,0.06)" }}
      >
        <Activity className="h-3 w-3" />
        Analyse abgeschlossen
      </motion.div>
      <motion.h1
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        className="lp-display text-[28px] font-semibold leading-[1.15] text-[var(--lp-text)] sm:text-[34px]"
      >
        Du bist nah dran — aber{" "}
        <span
          style={{
            background: "linear-gradient(90deg, #2ED3B7 0%, #59F0D0 60%, #a78bfa 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          zwei Kompetenzlücken
        </span>{" "}
        kosten dich aktuell die Prüfung.
      </motion.h1>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.7, delay: 0.35 }}
        className="mt-3 text-[15px] leading-relaxed text-[var(--lp-text-2)] sm:text-base"
      >
        Die meisten Punktverluste entstehen bei{" "}
        <span className="text-[var(--lp-text)]">Bewertungsaufgaben</span> und in
        der <span className="text-[var(--lp-text)]">Struktur des Fachgesprächs</span>.
        Das System hat einen 21-Tage-Pfad vorbereitet.
      </motion.p>
    </section>
  );
}

/* -------------------------------------------------------------------- */
/* Readiness Score — zentraler Systemzustand, lebt weiter               */
/* -------------------------------------------------------------------- */
function ReadinessScore() {
  const target = 57; // anschluss an Reveal-Szene
  const [val, setVal] = useState(0);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    // Sanftes Hochzählen — keine perfekte Easing-Linie
    const steps = [12, 24, 33, 41, 48, 53, 56, 57];
    steps.forEach((v, i) =>
      setTimeout(() => setVal(v), 350 + i * 110),
    );
  }, []);

  useEffect(() => {
    // Selten: subtiler Live-Pulse alle 11–14s
    const tick = () => {
      setPulse(true);
      setTimeout(() => setPulse(false), 700);
    };
    const id = setInterval(tick, 12500);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="lp-card relative mb-6 overflow-hidden p-5 sm:p-6">
      <AnimatePresence>
        {pulse && (
          <motion.div
            key="pulse"
            aria-hidden
            className="pointer-events-none absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            style={{
              background:
                "radial-gradient(60% 80% at 20% 50%, rgba(46,211,183,0.08), transparent 70%)",
            }}
          />
        )}
      </AnimatePresence>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--lp-text-3)]">
            Prüfungsreife-Score
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="lp-display text-[44px] font-semibold tabular-nums text-[var(--lp-text)] sm:text-[52px]">
              {val}
            </span>
            <span className="text-base text-[var(--lp-text-3)]">/100</span>
          </div>
          <div className="mt-1 text-[13px] text-[var(--lp-text-2)]">
            Knappes Bestehen wahrscheinlich
          </div>
        </div>
        <div
          className="flex flex-col items-end gap-2 rounded-xl border px-3 py-2"
          style={{
            borderColor: "rgba(245,183,84,0.28)",
            background: "rgba(245,183,84,0.06)",
          }}
        >
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--lp-warn)]">
            <AlertTriangle className="h-3 w-3" />
            Risikobereich
          </div>
          <span className="text-[11px] text-[var(--lp-text-3)] tabular-nums">
            −14 Pkt erwartet
          </span>
        </div>
      </div>

      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
        <motion.div
          className="h-full rounded-full"
          style={{
            background:
              "linear-gradient(90deg, #f5b754 0%, #2ED3B7 60%, #59F0D0 100%)",
          }}
          initial={{ width: 0 }}
          animate={{ width: `${val}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--lp-text-3)]">
        <span>Bestehensschwelle 65</span>
        <span className="text-[var(--lp-aqua)]">+8 Pkt / Woche im Pfad</span>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- */
/* Priority Competency — eine Haupthandlung                              */
/* -------------------------------------------------------------------- */
function PriorityCompetency() {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.16em] text-[var(--lp-text-3)]">
          Höchste Priorität
        </span>
        <span className="text-[11px] text-[var(--lp-text-3)]">
          1 von 8 Kompetenzen
        </span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.5 }}
        className="lp-card relative overflow-hidden p-5 sm:p-6"
        style={{
          borderColor: "var(--lp-border-emerald)",
          boxShadow:
            "0 0 0 1px rgba(46,211,183,0.18), 0 24px 60px -32px rgba(46,211,183,0.35)",
        }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-[var(--lp-emerald)]">
              Kompetenz · LF 5
            </div>
            <h2 className="lp-display mt-1 text-lg font-semibold text-[var(--lp-text)] sm:text-xl">
              Bewertungsaufgaben sicher strukturieren
            </h2>
          </div>
          <span
            className="shrink-0 rounded-md px-2 py-1 text-[10px] font-medium uppercase tracking-wider"
            style={{
              background: "rgba(239,77,107,0.10)",
              color: "var(--lp-danger)",
              border: "1px solid rgba(239,77,107,0.25)",
            }}
          >
            Hoch
          </span>
        </div>

        <ul className="mb-5 space-y-2 text-[13px] text-[var(--lp-text-2)]">
          <Tag>Relevant für schriftlich & mündlich</Tag>
          <Tag>Aktueller Punktverlust ≈ 9 Pkt</Tag>
          <Tag>Empfohlene Trainingsdauer · 22 Min</Tag>
        </ul>

        <Link
          to="/exam-trainer?mode=competency&priority=1&from=app-start"
          className="group flex w-full items-center justify-between rounded-xl px-5 py-4 text-[15px] font-medium transition-transform active:scale-[0.99]"
          style={{
            background:
              "linear-gradient(180deg, var(--lp-emerald), #1fb89e)",
            color: "#04221C",
            boxShadow: "0 12px 30px -12px rgba(46,211,183,0.55)",
          }}
        >
          <span>Diese Kompetenz jetzt trainieren</span>
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </motion.div>
    </section>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className="inline-block h-1 w-1 rounded-full"
        style={{ background: "var(--lp-emerald)" }}
      />
      {children}
    </li>
  );
}

/* -------------------------------------------------------------------- */
/* Tutor Whisper — diagnostischer Lernbegleiter, kein Chatbot           */
/* -------------------------------------------------------------------- */
function TutorWhisper() {
  return (
    <section className="mb-6">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.9 }}
        className="lp-glass flex items-start gap-3 rounded-2xl p-4"
      >
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: "rgba(167,139,250,0.12)",
            border: "1px solid rgba(167,139,250,0.28)",
          }}
        >
          <Brain className="h-4 w-4" style={{ color: "var(--lp-violet)" }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-[var(--lp-text-3)]">
            AI-Tutor · liest LF 5 · Rahmenplan
          </div>
          <p className="mt-1 text-[14px] leading-relaxed text-[var(--lp-text-2)]">
            Deine Schwäche liegt nicht im Wissen, sondern in der{" "}
            <span className="text-[var(--lp-text)]">Begründungs-Struktur</span>{" "}
            bei offenen Aufgaben. Drei Mikro-Sessions reichen, um das zu drehen.
          </p>
        </div>
      </motion.div>
    </section>
  );
}

/* -------------------------------------------------------------------- */
/* Secondary Stripe — optionale Exploration, dezent                     */
/* -------------------------------------------------------------------- */
function SecondaryStripe() {
  const items = [
    {
      to: "/exam-trainer?mode=oral&from=app-start",
      icon: ShieldCheck,
      label: "Fachgespräch simulieren",
      hint: "8 Min",
    },
    {
      to: "/dashboard?view=heatmap",
      icon: Sparkles,
      label: "Vollständige Heatmap öffnen",
      hint: "8 Lernfelder",
    },
  ];
  return (
    <section className="mt-4">
      <div className="mb-3 text-[11px] uppercase tracking-[0.16em] text-[var(--lp-text-3)]">
        Weiteres aus deiner Analyse
      </div>
      <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-elev)]/60">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <li key={it.to}>
              <Link
                to={it.to}
                className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.03]"
              >
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{
                    background: "rgba(46,211,183,0.06)",
                    border: "1px solid var(--lp-border)",
                  }}
                >
                  <Icon className="h-4 w-4 text-[var(--lp-aqua)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] text-[var(--lp-text)]">
                    {it.label}
                  </div>
                  <div className="text-[11px] text-[var(--lp-text-3)]">
                    {it.hint}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-[var(--lp-text-3)]" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
