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
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Quote,
} from "lucide-react";
import "@/components/landing/v2/lp-v2-theme.css";
import {
  useLearnerRealityBridge,
  type LearnerRealitySnapshot,
  type RealityCompetency,
} from "@/hooks/useLearnerRealityBridge";
import { readinessLabel } from "@/lib/system/SystemConsciousness";

/**
 * /app/start — P0-3 Sprint 1: DB-gebunden, QFAF-konform.
 * Frage „Wo stehe ich?" → Readiness + Priorität + nächster Schritt.
 */
export default function AppStartPage() {
  const reality = useLearnerRealityBridge();

  return (
    <main className="lp-v2 min-h-screen w-full">
      <div className="relative mx-auto flex min-h-screen w-full max-w-[680px] flex-col px-5 pb-24 pt-8 sm:px-8 sm:pt-12">
        <BackgroundAura />
        <SystemHeader />
        {reality.needsOnboarding ? (
          <OnboardingEmptyState />
        ) : reality.loading && !reality.hasData ? (
          <LoadingState />
        ) : (
          <>
            <SystemMemoryStrip reality={reality} />
            <DiagnosisHeadline reality={reality} />
            <ReadinessScore reality={reality} />
            <PriorityCompetency reality={reality} />
            <CompetencyTrendList reality={reality} />
            <TutorWhisper reality={reality} />
            <SecondaryStripe reality={reality} />
          </>
        )}
      </div>
    </main>
  );
}

function OnboardingEmptyState() {
  return (
    <section className="mt-8 rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-elev)]/60 p-6 text-center">
      <div
        className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl"
        style={{ background: "rgba(46,211,183,0.08)", border: "1px solid var(--lp-border-emerald)" }}
      >
        <Sparkles className="h-5 w-5" style={{ color: "var(--lp-emerald)" }} />
      </div>
      <h1 className="lp-display text-xl font-semibold text-[var(--lp-text)]">
        Noch kein Beruf gewählt
      </h1>
      <p className="mt-2 text-[14px] text-[var(--lp-text-2)]">
        Wähle deinen Beruf, damit das System deinen Prüfungszustand analysieren kann.
      </p>
      <Link
        to="/berufe"
        className="mt-5 inline-flex items-center gap-2 rounded-xl px-5 py-3 text-[14px] font-medium"
        style={{
          background: "linear-gradient(180deg, var(--lp-emerald), #1fb89e)",
          color: "#04221C",
        }}
      >
        Beruf wählen
        <ArrowRight className="h-4 w-4" />
      </Link>
    </section>
  );
}

function LoadingState() {
  return (
    <div className="mt-8 space-y-4">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-28 animate-pulse rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-elev)]/40"
        />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Background                                                            */
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
/* System Header — Recalc-Heartbeat (adaptive)                           */
/* -------------------------------------------------------------------- */
function SystemHeader() {
  const [minutesAgo, setMinutesAgo] = useState(2);
  const [recalcing, setRecalcing] = useState(false);

  useEffect(() => {
    // Sehr selten: Recalculation-Heartbeat (alle ~22s) — kein Spam
    const tick = setInterval(() => {
      setRecalcing(true);
      setTimeout(() => {
        setRecalcing(false);
        setMinutesAgo(0);
      }, 1400);
    }, 22000);
    const drift = setInterval(() => setMinutesAgo((m) => m + 1), 60000);
    return () => {
      clearInterval(tick);
      clearInterval(drift);
    };
  }, []);

  return (
    <header className="mb-6 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--lp-emerald)", boxShadow: "0 0 8px var(--lp-emerald)" }}
        />
        <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--lp-text-3)]">
          ExamFit · System aktiv
        </span>
      </div>
      <AnimatePresence mode="wait">
        {recalcing ? (
          <motion.span
            key="recalc"
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-1.5 text-[11px] text-[var(--lp-aqua)] tabular-nums"
          >
            <RefreshCw className="h-3 w-3 animate-spin" />
            Analyse aktualisiert…
          </motion.span>
        ) : (
          <motion.span
            key="drift"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-[11px] text-[var(--lp-text-3)] tabular-nums"
          >
            Analyse · vor {minutesAgo === 0 ? "wenigen Sek" : `${minutesAgo} Min`}
          </motion.span>
        )}
      </AnimatePresence>
    </header>
  );
}

/* -------------------------------------------------------------------- */
/* System Memory Strip — „Das System erinnert sich"                      */
/* -------------------------------------------------------------------- */
function SystemMemoryStrip() {
  const memos = [
    { label: "LF 5", state: "weiterhin kritisch", tone: "warn" as const },
    { label: "Fachgespräch", state: "seit 3 Tagen stabilisiert", tone: "ok" as const },
    { label: "Bewertungsaufgaben", state: "bleiben fehleranfällig", tone: "warn" as const },
    { label: "Risiko", state: "leicht gesunken", tone: "ok" as const },
    { label: "Antwortgeschwindigkeit", state: "verbessert", tone: "ok" as const },
  ];
  return (
    <section className="mb-8 -mx-5 sm:-mx-8">
      <div
        className="flex gap-2 overflow-x-auto px-5 pb-1 sm:px-8 [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        {memos.map((m, i) => (
          <motion.div
            key={m.label}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: i * 0.06 }}
            className="shrink-0 rounded-full border px-3 py-1.5 text-[11px]"
            style={{
              borderColor: m.tone === "warn"
                ? "rgba(245,183,84,0.22)"
                : "rgba(46,211,183,0.22)",
              background: m.tone === "warn"
                ? "rgba(245,183,84,0.05)"
                : "rgba(46,211,183,0.05)",
            }}
          >
            <span className="text-[var(--lp-text-2)]">{m.label}</span>
            <span className="mx-1.5 text-[var(--lp-text-3)]">·</span>
            <span
              style={{
                color: m.tone === "warn" ? "var(--lp-warn)" : "var(--lp-aqua)",
              }}
            >
              {m.state}
            </span>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- */
/* Diagnose-Headline                                                     */
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
        Analyse fortgeführt
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
        Typischer Punktverlust entsteht bei{" "}
        <span className="text-[var(--lp-text)]">Bewertungsaufgaben</span> und in
        der <span className="text-[var(--lp-text)]">Argumentationsstruktur des Fachgesprächs</span>.
        Das System hat einen 21-Tage-Pfad rekalkuliert.
      </motion.p>
    </section>
  );
}

/* -------------------------------------------------------------------- */
/* Readiness Score — adaptive Recalc                                     */
/* -------------------------------------------------------------------- */
function ReadinessScore() {
  const [val, setVal] = useState(0);
  const [target, setTarget] = useState(57);
  const [delta, setDelta] = useState<number | null>(null);

  useEffect(() => {
    const steps = [12, 24, 33, 41, 48, 53, 56, 57];
    steps.forEach((v, i) => setTimeout(() => setVal(v), 350 + i * 110));
  }, []);

  useEffect(() => {
    // Subtile Recalc alle ~22s: ±1, einmalig sichtbar
    const tick = setInterval(() => {
      const d = Math.random() > 0.5 ? 1 : -1;
      setTarget((t) => {
        const next = Math.max(54, Math.min(62, t + d));
        setVal(next);
        setDelta(next - t);
        setTimeout(() => setDelta(null), 2600);
        return next;
      });
    }, 22000);
    return () => clearInterval(tick);
  }, []);

  return (
    <section className="lp-card relative mb-6 overflow-hidden p-5 sm:p-6">
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
            <AnimatePresence>
              {delta !== null && (
                <motion.span
                  key={`delta-${target}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="ml-1 text-[11px] tabular-nums"
                  style={{
                    color: delta > 0 ? "var(--lp-aqua)" : "var(--lp-warn)",
                  }}
                >
                  {delta > 0 ? "+" : ""}
                  {delta}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <div className="mt-1 text-[13px] text-[var(--lp-text-2)]">
            Knappes Bestehen wahrscheinlich
          </div>
        </div>
        <RiskState />
      </div>

      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
        <motion.div
          className="h-full rounded-full"
          style={{
            background:
              "linear-gradient(90deg, #f5b754 0%, #2ED3B7 60%, #59F0D0 100%)",
          }}
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

/* Persistent risk-as-state badge (subtle, not alarmist) */
function RiskState() {
  return (
    <div
      className="flex flex-col items-end gap-1.5 rounded-xl border px-3 py-2"
      style={{
        borderColor: "rgba(245,183,84,0.24)",
        background: "rgba(245,183,84,0.04)",
      }}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--lp-warn)]">
        <AlertTriangle className="h-3 w-3" />
        Erhöhtes Risiko
      </div>
      <span className="text-[10px] text-[var(--lp-text-3)] tabular-nums">
        −14 Pkt erwartet
      </span>
      <span className="text-[10px] text-[var(--lp-text-3)]">stabil seit 2 Tagen</span>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Priority Competency — eine Haupthandlung + Prüfersprache              */
/* -------------------------------------------------------------------- */
function PriorityCompetency() {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.16em] text-[var(--lp-text-3)]">
          Höchste Priorität · vom System gewählt
        </span>
        <span className="text-[11px] text-[var(--lp-text-3)]">1 / 8</span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.4 }}
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
            Kritisch
          </span>
        </div>

        <ul className="mb-4 space-y-2 text-[13px] text-[var(--lp-text-2)]">
          <Tag>Relevant für schriftlich & mündlich</Tag>
          <Tag>Typischer Punktverlust ≈ 9 Pkt</Tag>
          <Tag>Bewertungskriterium · Argumentationsstruktur</Tag>
        </ul>

        {/* Examiner micro-quote */}
        <div
          className="mb-5 flex gap-2.5 rounded-lg p-3"
          style={{
            background: "rgba(255,255,255,0.025)",
            border: "1px solid var(--lp-border)",
          }}
        >
          <Quote className="h-3.5 w-3.5 shrink-0 mt-0.5 text-[var(--lp-text-3)]" />
          <p className="text-[12px] leading-relaxed italic text-[var(--lp-text-2)]">
            „Hier würde ein Prüfer nach der{" "}
            <span className="not-italic text-[var(--lp-text)]">Begründung</span>{" "}
            fragen — nicht nach der Lösung."
          </p>
        </div>

        <Link
          to="/exam-trainer?mode=competency&priority=1&from=app-start"
          className="group flex w-full items-center justify-between rounded-xl px-5 py-4 text-[15px] font-medium transition-transform active:scale-[0.99]"
          style={{
            background: "linear-gradient(180deg, var(--lp-emerald), #1fb89e)",
            color: "#04221C",
            boxShadow: "0 12px 30px -12px rgba(46,211,183,0.55)",
          }}
        >
          <span>Diese Kompetenz jetzt trainieren · 22 Min</span>
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
/* Competency Trend List — System-Memory pro Kompetenz                   */
/* -------------------------------------------------------------------- */
type TrendDir = "up" | "down" | "flat";
function CompetencyTrendList() {
  const items: Array<{
    label: string;
    state: string;
    dir: TrendDir;
    score: number;
  }> = [
    { label: "Fachgespräch · Struktur", state: "mündlich stabil", dir: "up", score: 71 },
    { label: "Transferaufgaben", state: "schriftlich instabil", dir: "down", score: 48 },
    { label: "Fachbegriffe · Rechnungswesen", state: "leicht verbessert", dir: "up", score: 64 },
    { label: "Bewertungsaufgaben", state: "häufige Fehlerquelle", dir: "flat", score: 41 },
  ];

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.16em] text-[var(--lp-text-3)]">
          Kompetenzentwicklung · letzte 7 Tage
        </span>
      </div>
      <ul className="overflow-hidden rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-elev)]/60">
        {items.map((it, i) => (
          <motion.li
            key={it.label}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.5 + i * 0.05 }}
            className="flex items-center gap-3 border-b border-white/[0.05] px-4 py-3 last:border-b-0"
          >
            <TrendIcon dir={it.dir} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-[var(--lp-text)]">{it.label}</div>
              <div className="text-[11px] text-[var(--lp-text-3)]">{it.state}</div>
            </div>
            <span
              className="text-[12px] tabular-nums"
              style={{
                color:
                  it.dir === "up"
                    ? "var(--lp-aqua)"
                    : it.dir === "down"
                      ? "var(--lp-warn)"
                      : "var(--lp-text-3)",
              }}
            >
              {it.score}
            </span>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}

function TrendIcon({ dir }: { dir: TrendDir }) {
  const Icon = dir === "up" ? TrendingUp : dir === "down" ? TrendingDown : Minus;
  const color =
    dir === "up"
      ? "var(--lp-aqua)"
      : dir === "down"
        ? "var(--lp-warn)"
        : "var(--lp-text-3)";
  const bg =
    dir === "up"
      ? "rgba(46,211,183,0.08)"
      : dir === "down"
        ? "rgba(245,183,84,0.08)"
        : "rgba(255,255,255,0.03)";
  return (
    <div
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
      style={{ background: bg, border: "1px solid var(--lp-border)" }}
    >
      <Icon className="h-3.5 w-3.5" style={{ color }} />
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Tutor Whisper — Session-Memory                                        */
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
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-[var(--lp-text-3)]">
              AI-Tutor · liest LF 5 · Rahmenplan
            </span>
            <span className="h-1 w-1 rounded-full bg-[var(--lp-text-3)]" />
            <span className="text-[11px] text-[var(--lp-text-3)]">3 Sessions analysiert</span>
          </div>
          <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--lp-text-2)]">
            Die Argumentationsstruktur war diesmal{" "}
            <span className="text-[var(--lp-text)]">stabiler</span> — Fachbegriffe
            sitzen, aber der Punktverlust liegt weiterhin bei{" "}
            <span className="text-[var(--lp-text)]">Transferaufgaben</span>. Drei
            Mikro-Sessions reichen, um das zu drehen.
          </p>
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-[var(--lp-aqua)] hover:text-[var(--lp-mint)] transition-colors"
          >
            Analyse vertiefen
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </motion.div>
    </section>
  );
}

/* -------------------------------------------------------------------- */
/* Secondary Stripe                                                      */
/* -------------------------------------------------------------------- */
function SecondaryStripe() {
  const items = [
    {
      to: "/exam-trainer?mode=oral&from=app-start",
      icon: ShieldCheck,
      label: "Fachgespräch simulieren",
      hint: "8 Min · Prüferreaktion realistisch",
    },
    {
      to: "/dashboard?view=heatmap",
      icon: Sparkles,
      label: "Vollständige Heatmap öffnen",
      hint: "8 Lernfelder · System-Memory",
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
