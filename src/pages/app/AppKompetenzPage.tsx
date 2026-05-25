import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSystemConsciousness, type RiskKey } from "@/lib/system/SystemConsciousness";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Brain,
  ChevronRight,
  Eye,
  Quote,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  Minus,
  Flame,
} from "lucide-react";
import "@/components/landing/v2/lp-v2-theme.css";
import { RecoveryPlanCard } from "@/components/recovery/RecoveryPlanCard";

/**
 * /app/kompetenz/:competencyId — Phase 5.5: Diagnostischer Kompetenzraum
 *
 * Kein Kapitel. Keine Lerninhaltseite. Keine Wissenssammlung.
 *
 * Leitfrage:
 *   „Wie gefährlich ist diese Kompetenz aktuell für deine Prüfung?“
 *
 * Aufbau:
 *   1. Risk-Headline + Prüfungszustand (zuerst Zustand, dann Inhalt)
 *   2. Verlauf (Stabilität über Zeit)
 *   3. Typische Punktverluste
 *   4. Prüfungsrelevanz (schriftlich + mündlich)
 *   5. Tutor-Beobachtungen (Brücke zum Tutor)
 *   6. Stabilisierungs-Hebel (ein Schritt, kein Optionsmenü)
 */
export default function AppKompetenzPage() {
  const { competencyId } = useParams();
  const data = useMemo(() => deriveCompetency(competencyId), [competencyId]);
  const system = useSystemConsciousness();
  const wroteRef = useRef<string | null>(null);

  // Cross-Surface-Sync: Kompetenz-Beobachtung in globalen Zustand spiegeln
  useEffect(() => {
    if (wroteRef.current === data.id) return;
    wroteRef.current = data.id;
    const riskKey: RiskKey = data.id === "lf5" ? "lf5_bewertung" : "transfer_argumentation";
    system.updateRisk(riskKey, {
      label: data.riskHeadline,
      tone: data.riskTone,
    });
    system.remember(
      `${data.name} · ${data.stateLabel}`,
      "Tutor",
      data.riskTone,
    );
    system.recalc("Kompetenz erneut bewertet");
  }, [data, system]);



  return (
    <main className="lp-v2 min-h-screen w-full">
      <div className="relative mx-auto flex min-h-screen w-full max-w-[680px] flex-col px-5 pb-28 pt-8 sm:px-8 sm:pt-12">
        <BackgroundAura tone={data.riskTone} />
        <KompetenzHeader breadcrumb={data.breadcrumb} />
        <RiskHeadline data={data} />
        <StabilityTimeline data={data} />
        <TypicalPointLoss data={data} />
        <ExamRelevance data={data} />
        <TutorObservations data={data} />
        <StabilizationLever data={data} />
        <RecoveryPlanCard
          sourceEntityKind="app_kompetenz"
          sourceEntitySlug={data.id}
          limit={3}
        />
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Domain Types & Derivation                                           */
/* ------------------------------------------------------------------ */
type RiskTone = "critical" | "watch" | "stable";

interface CompetencyView {
  id: string;
  name: string;
  breadcrumb: string;
  riskTone: RiskTone;
  riskHeadline: string;
  stateLabel: string;
  stabilityDelta: string;
  passContribution: string;
  examinerQuote: string;
  history: Array<{ label: string; value: number; tone: RiskTone }>;
  pointLosses: Array<{ type: string; share: number; note: string }>;
  written: { weight: string; note: string };
  oral: { weight: string; note: string };
  tutorObservations: string[];
  lever: { title: string; subline: string; minutes: number; deltaPoints: number };
}

const COMPETENCY_MAP: Record<string, Partial<CompetencyView>> = {
  lf5: {
    name: "Rechnungswesen · Jahresabschluss",
    breadcrumb: "Lernfeld 5 · Industriekaufmann/-frau",
    riskTone: "critical",
    riskHeadline:
      "Diese Kompetenz kostet aktuell die meisten Punkte deiner Prüfungsreife.",
    stateLabel: "instabil · seit 9 Tagen priorisiert",
    stabilityDelta: "−6 Pkt seit letzter Analyse",
    passContribution: "Trägt ~22 % zur Gesamt-Prüfungsreife bei",
    examinerQuote:
      "Hier würde ein Prüfer nach der Begründung des Wertansatzes fragen.",
  },
};

function deriveCompetency(idRaw?: string): CompetencyView {
  const id = (idRaw ?? "lf5").toLowerCase();
  const seed = COMPETENCY_MAP[id] ?? COMPETENCY_MAP.lf5;

  return {
    id,
    name: seed.name ?? "Rechnungswesen · Jahresabschluss",
    breadcrumb: seed.breadcrumb ?? "Lernfeld · Prüfungsrelevant",
    riskTone: (seed.riskTone as RiskTone) ?? "watch",
    riskHeadline:
      seed.riskHeadline ??
      "Diese Kompetenz beeinflusst dein Prüfungsergebnis derzeit spürbar.",
    stateLabel: seed.stateLabel ?? "beobachtet · zuletzt verbessert",
    stabilityDelta: seed.stabilityDelta ?? "−3 Pkt seit letzter Analyse",
    passContribution: seed.passContribution ?? "Trägt ~14 % zur Prüfungsreife bei",
    examinerQuote:
      seed.examinerQuote ??
      "Ein Prüfer würde hier die Argumentationsstruktur prüfen.",
    history: [
      { label: "−14 T.", value: 64, tone: "watch" },
      { label: "−10 T.", value: 61, tone: "critical" },
      { label: "−7 T.", value: 58, tone: "critical" },
      { label: "−3 T.", value: 60, tone: "watch" },
      { label: "heute", value: 57, tone: "critical" },
    ],
    pointLosses: [
      {
        type: "Begründung des Wertansatzes",
        share: 38,
        note: "Antwort bleibt fachlich, Begründung kommt zu spät.",
      },
      {
        type: "Transferaufgaben > 90 Sek.",
        share: 27,
        note: "Zeitdruck führt zu Sprüngen in der Struktur.",
      },
      {
        type: "Rückfragen zur Bewertung",
        share: 19,
        note: "Definition vorhanden, aber kein Praxisbezug.",
      },
    ],
    written: {
      weight: "hoch",
      note:
        "In den letzten 3 Probeprüfungen war LF5 für 4 von 6 verlorenen Punktblöcken verantwortlich.",
    },
    oral: {
      weight: "sehr hoch",
      note:
        "Im Fachgespräch entstehen hier 70 % aller Rückfragen — meist auf der Begründungsebene.",
    },
    tutorObservations: [
      "Punktverlust korreliert mit Aufgaben > 90 Sek. Bearbeitungszeit.",
      "Praxisbezug zuletzt stabiler — Wertansatz-Begründung weiterhin schwach.",
      "Lernpfad wurde deshalb vorgezogen.",
    ],
    lever: {
      title: "Begründungs-Drill auf Wertansatz-Aufgaben",
      subline:
        "12 Minuten, 6 Aufgaben mit erzwungener Begründungs­struktur — adressiert das Muster direkt.",
      minutes: 12,
      deltaPoints: 4,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Background & Header                                                 */
/* ------------------------------------------------------------------ */
function BackgroundAura({ tone }: { tone: RiskTone }) {
  const gradient =
    tone === "critical"
      ? "radial-gradient(60% 100% at 50% 0%, rgba(232,150,150,0.10) 0%, rgba(232,150,150,0) 70%)"
      : tone === "watch"
      ? "radial-gradient(60% 100% at 50% 0%, rgba(232,196,120,0.09) 0%, rgba(232,196,120,0) 70%)"
      : "radial-gradient(60% 100% at 50% 0%, rgba(46,211,183,0.08) 0%, rgba(46,211,183,0) 70%)";
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[460px]"
      style={{ background: gradient }}
    />
  );
}

function KompetenzHeader({ breadcrumb }: { breadcrumb: string }) {
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
          <Target className="h-3.5 w-3.5" style={{ color: "rgb(120,235,210)" }} />
        </div>
        <span
          className="text-[11px] uppercase tracking-[0.18em]"
          style={{ color: "rgba(220,235,232,0.62)" }}
        >
          {breadcrumb}
        </span>
      </div>
      <Link
        to="/app/lernpfad"
        className="text-[11px] uppercase tracking-[0.16em]"
        style={{ color: "rgba(220,235,232,0.5)" }}
      >
        Strategie
      </Link>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* 1. Risk Headline — Zustand zuerst, nicht Inhalt                     */
/* ------------------------------------------------------------------ */
function RiskHeadline({ data }: { data: CompetencyView }) {
  const t = toneTokens(data.riskTone);
  return (
    <section
      className="lp-surface mb-5 overflow-hidden rounded-[22px] p-5"
      style={{
        border: `1px solid ${t.border}`,
        background: `linear-gradient(180deg, ${t.bgFrom}, ${t.bgTo})`,
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <RiskDot tone={data.riskTone} />
        <span
          className="text-[10.5px] uppercase tracking-[0.2em]"
          style={{ color: t.eyebrow }}
        >
          Prüfungszustand · {data.stateLabel}
        </span>
      </div>
      <h1
        className="lp-display mb-2 text-[22px] leading-[1.25] sm:text-[24px]"
        style={{ color: "rgba(238,247,245,0.97)" }}
      >
        {data.name}
      </h1>
      <p
        className="lp-display text-[16px] leading-[1.45]"
        style={{ color: t.headline }}
      >
        {data.riskHeadline}
      </p>
      <div
        className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px]"
        style={{ color: "rgba(220,235,232,0.6)" }}
      >
        <span className="inline-flex items-center gap-1.5">
          <TrendingDown className="h-3 w-3" style={{ color: t.eyebrow }} />
          {data.stabilityDelta}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Flame className="h-3 w-3" style={{ color: t.eyebrow }} />
          {data.passContribution}
        </span>
      </div>
    </section>
  );
}

function RiskDot({ tone }: { tone: RiskTone }) {
  const c =
    tone === "critical"
      ? "rgb(232,150,150)"
      : tone === "watch"
      ? "rgb(232,196,120)"
      : "rgb(120,235,210)";
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      <motion.span
        className="absolute inset-0 rounded-full"
        style={{ background: c, opacity: 0.35 }}
        animate={{ scale: [1, 1.8, 1], opacity: [0.5, 0, 0.5] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
      />
      <span
        className="relative inline-block h-2.5 w-2.5 rounded-full"
        style={{ background: c }}
      />
    </span>
  );
}

function toneTokens(tone: RiskTone) {
  if (tone === "critical") {
    return {
      border: "rgba(232,150,150,0.22)",
      bgFrom: "rgba(40,22,22,0.45)",
      bgTo: "rgba(20,14,14,0.35)",
      eyebrow: "rgba(232,180,180,0.82)",
      headline: "rgba(245,232,232,0.96)",
    };
  }
  if (tone === "watch") {
    return {
      border: "rgba(232,196,120,0.22)",
      bgFrom: "rgba(38,30,18,0.45)",
      bgTo: "rgba(20,16,12,0.35)",
      eyebrow: "rgba(238,210,150,0.85)",
      headline: "rgba(245,238,225,0.96)",
    };
  }
  return {
    border: "rgba(46,211,183,0.22)",
    bgFrom: "rgba(18,36,40,0.55)",
    bgTo: "rgba(12,22,26,0.45)",
    eyebrow: "rgba(120,235,210,0.82)",
    headline: "rgba(238,247,245,0.96)",
  };
}

/* ------------------------------------------------------------------ */
/* 2. Stability Timeline                                               */
/* ------------------------------------------------------------------ */
function StabilityTimeline({ data }: { data: CompetencyView }) {
  const max = Math.max(...data.history.map((h) => h.value));
  const min = Math.min(...data.history.map((h) => h.value));
  return (
    <section className="mb-6">
      <SectionHeader
        eyebrow="Verlauf · Stabilität"
        title="Wie sich diese Kompetenz zuletzt verhalten hat"
      />
      <div
        className="rounded-[18px] p-5"
        style={{
          border: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(14,24,28,0.5)",
        }}
      >
        <div className="flex items-end justify-between gap-3 h-[120px]">
          {data.history.map((h, i) => {
            const heightPct = ((h.value - (min - 4)) / (max - (min - 4))) * 100;
            const color =
              h.tone === "critical"
                ? "rgb(232,150,150)"
                : h.tone === "watch"
                ? "rgb(232,196,120)"
                : "rgb(120,235,210)";
            return (
              <div key={i} className="flex flex-1 flex-col items-center gap-2">
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: `${heightPct}%` }}
                  transition={{ delay: i * 0.08, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                  className="w-full max-w-[28px] rounded-full"
                  style={{
                    background: `linear-gradient(180deg, ${color}, ${color}55)`,
                    minHeight: 8,
                  }}
                />
                <span
                  className="text-[10px] uppercase tracking-[0.12em]"
                  style={{ color: "rgba(220,235,232,0.5)" }}
                >
                  {h.label}
                </span>
              </div>
            );
          })}
        </div>
        <p
          className="mt-4 text-[12.5px] leading-[1.55]"
          style={{ color: "rgba(220,235,232,0.65)" }}
        >
          Stabilität schwankt — kein Aufwärtstrend. Das System wertet das als
          strukturelles Muster, nicht als Tagesform.
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Typical Point Loss                                               */
/* ------------------------------------------------------------------ */
function TypicalPointLoss({ data }: { data: CompetencyView }) {
  return (
    <section className="mb-6">
      <SectionHeader
        eyebrow="Punktverlust-Muster"
        title="Wo in dieser Kompetenz Punkte verloren gehen"
      />
      <ul className="space-y-2">
        {data.pointLosses.map((p, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.4 }}
            className="rounded-[14px] p-4"
            style={{
              border: "1px solid rgba(255,255,255,0.05)",
              background: "rgba(14,24,28,0.5)",
            }}
          >
            <div className="mb-1.5 flex items-center justify-between">
              <span
                className="text-[13.5px] font-medium"
                style={{ color: "rgba(238,247,245,0.92)" }}
              >
                {p.type}
              </span>
              <span
                className="text-[11.5px] tabular-nums"
                style={{ color: "rgb(232,180,180)" }}
              >
                −{p.share}%
              </span>
            </div>
            <div
              className="mb-2 h-[3px] w-full overflow-hidden rounded-full"
              style={{ background: "rgba(255,255,255,0.05)" }}
            >
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${p.share}%` }}
                transition={{ delay: i * 0.06 + 0.15, duration: 0.6 }}
                className="h-full rounded-full"
                style={{
                  background:
                    "linear-gradient(90deg, rgba(232,150,150,0.85), rgba(232,180,150,0.6))",
                }}
              />
            </div>
            <p
              className="text-[12.5px] leading-[1.5]"
              style={{ color: "rgba(220,235,232,0.6)" }}
            >
              {p.note}
            </p>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Exam Relevance — schriftlich + mündlich                          */
/* ------------------------------------------------------------------ */
function ExamRelevance({ data }: { data: CompetencyView }) {
  return (
    <section className="mb-6">
      <SectionHeader
        eyebrow="Prüfungsrelevanz"
        title="So gewichtet die Prüfung diese Kompetenz"
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <RelevanceCard
          label="Schriftlich"
          weight={data.written.weight}
          note={data.written.note}
          to="/app/lernpfad"
          icon={<ShieldCheck className="h-3.5 w-3.5" />}
        />
        <RelevanceCard
          label="Mündlich · Fachgespräch"
          weight={data.oral.weight}
          note={data.oral.note}
          to="/app/oral"
          icon={<Activity className="h-3.5 w-3.5" />}
        />
      </div>
    </section>
  );
}

function RelevanceCard({
  label,
  weight,
  note,
  to,
  icon,
}: {
  label: string;
  weight: string;
  note: string;
  to: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="block rounded-[16px] p-4 transition-transform hover:-translate-y-0.5"
      style={{
        border: "1px solid rgba(255,255,255,0.06)",
        background:
          "linear-gradient(180deg, rgba(18,28,32,0.55), rgba(12,20,24,0.4))",
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span
          className="inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.18em]"
          style={{ color: "rgba(120,235,210,0.78)" }}
        >
          {icon}
          {label}
        </span>
        <span
          className="text-[10.5px] uppercase tracking-[0.14em]"
          style={{ color: "rgb(232,196,120)" }}
        >
          Gewicht · {weight}
        </span>
      </div>
      <p
        className="text-[13px] leading-[1.5]"
        style={{ color: "rgba(220,235,232,0.78)" }}
      >
        {note}
      </p>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* 5. Tutor Observations — Brücke                                      */
/* ------------------------------------------------------------------ */
function TutorObservations({ data }: { data: CompetencyView }) {
  return (
    <section className="mb-6">
      <SectionHeader eyebrow="Tutor · Beobachtungen" title="Was das System in dieser Kompetenz registriert hat" />
      <div
        className="rounded-[18px] p-5"
        style={{
          border: "1px solid rgba(46,211,183,0.16)",
          background:
            "linear-gradient(180deg, rgba(18,32,34,0.55), rgba(12,22,24,0.4))",
        }}
      >
        <ul className="space-y-2.5">
          {data.tutorObservations.map((o, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <Eye
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                style={{ color: "rgba(120,235,210,0.75)" }}
              />
              <span
                className="text-[13.5px] leading-[1.55]"
                style={{ color: "rgba(238,247,245,0.9)" }}
              >
                {o}
              </span>
            </li>
          ))}
        </ul>
        <div
          className="mt-4 rounded-[12px] border-l-2 p-3"
          style={{
            borderColor: "rgba(232,196,120,0.5)",
            background: "rgba(38,30,18,0.3)",
          }}
        >
          <Quote
            className="mb-1 h-3.5 w-3.5"
            style={{ color: "rgba(232,196,120,0.7)" }}
          />
          <p
            className="lp-display text-[14.5px] italic leading-[1.5]"
            style={{ color: "rgba(245,238,225,0.92)" }}
          >
            „{data.examinerQuote}“
          </p>
        </div>
        <Link
          to="/app/tutor"
          className="mt-4 inline-flex items-center gap-1 text-[12px] uppercase tracking-[0.16em]"
          style={{ color: "rgba(120,235,210,0.85)" }}
        >
          gesamten Verlauf im Tutor
          <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 6. Stabilization Lever — ein Schritt, kein Optionsmenü              */
/* ------------------------------------------------------------------ */
function StabilizationLever({ data }: { data: CompetencyView }) {
  return (
    <section>
      <SectionHeader
        eyebrow="Stabilisierungs-Hebel"
        title="Das ist jetzt der präziseste Eingriff"
      />
      <div
        className="rounded-[18px] p-5"
        style={{
          border: "1px solid rgba(46,211,183,0.24)",
          background:
            "linear-gradient(180deg, rgba(18,36,40,0.6), rgba(12,22,26,0.5))",
        }}
      >
        <div className="mb-3 flex items-center justify-between">
          <span
            className="text-[10.5px] uppercase tracking-[0.2em]"
            style={{ color: "rgba(120,235,210,0.8)" }}
          >
            Tutor-Empfehlung · 1 Schritt
          </span>
          <span
            className="text-[10.5px] uppercase tracking-[0.16em]"
            style={{ color: "rgba(220,235,232,0.5)" }}
          >
            Δ Prüfungsreife · +{data.lever.deltaPoints}
          </span>
        </div>
        <h3
          className="lp-display text-[20px] leading-[1.3]"
          style={{ color: "rgba(238,247,245,0.96)" }}
        >
          {data.lever.title}
        </h3>
        <p
          className="mt-2 text-[13.5px] leading-[1.55]"
          style={{ color: "rgba(220,235,232,0.7)" }}
        >
          {data.lever.subline}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            to="/app/lernpfad"
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-medium"
            style={{
              background:
                "linear-gradient(135deg, rgba(46,211,183,0.95), rgba(36,180,160,0.95))",
              color: "rgb(8,18,20)",
              boxShadow: "0 8px 24px -10px rgba(46,211,183,0.5)",
            }}
          >
            Drill starten · {data.lever.minutes} Min
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            to="/app/oral"
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px]"
            style={{
              border: "1px solid rgba(220,235,232,0.16)",
              color: "rgba(220,235,232,0.82)",
            }}
          >
            stattdessen Fachgespräch
            <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
      <p
        className="mt-5 text-center text-[10.5px] uppercase tracking-[0.18em]"
        style={{ color: "rgba(220,235,232,0.32)" }}
      >
        Die Kompetenz wird neu bewertet, sobald der Schritt abgeschlossen ist.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Section Header                                                       */
/* ------------------------------------------------------------------ */
function SectionHeader({
  eyebrow,
  title,
}: {
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="mb-3">
      <div
        className="mb-1 text-[10.5px] uppercase tracking-[0.2em]"
        style={{ color: "rgba(120,235,210,0.7)" }}
      >
        {eyebrow}
      </div>
      <h2
        className="lp-display text-[15.5px] leading-[1.35]"
        style={{ color: "rgba(238,247,245,0.92)" }}
      >
        {title}
      </h2>
    </div>
  );
}
