import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSystemConsciousness } from "@/lib/system/SystemConsciousness";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  ArrowRight,
  Brain,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock,
  Cpu,
  Gauge,
  History,
  Radar,
  Sparkles,
  Target,
  Waves,
} from "lucide-react";

/* =====================================================================
 * Phase 5.6 — MiniChecks → Diagnostische Prüfungsimpulse
 * ---------------------------------------------------------------------
 * Kein Quiz. Kein "richtig/falsch". Sondern: kontinuierliche Stabilitäts-
 * messung. Jede Frage ist ein bewusst gewählter Impuls, der den
 * Prüfungszustand des Nutzers reevaluiert. Antworten verändern Zustände,
 * nicht Punkte.
 *
 * Tokens-only (kein hartes #FFFFFF), Petrol/Aqua dominant, Rot ruhig.
 * Motion ruhig, bewusst, deliberativ.
 * =================================================================== */

/* ------------------------------ Types ------------------------------ */

type RiskTone = "critical" | "watch" | "stable";

type Stage = "pre" | "question" | "analyzing" | "reflect" | "summary";

type DiagPrompt = {
  id: string;
  competency: string;
  competencyId: string;
  field: string;
  riskBefore: RiskTone;
  stateBefore: string;
  examRelevance: string;
  typicalLoss: string;
  selectionReason: string;
  question: string;
  options: { id: string; label: string; quality: "weak" | "partial" | "strong" }[];
  examinerNote: string;
  tutorDebrief: string;
  stateAfter: (q: "weak" | "partial" | "strong") => {
    risk: RiskTone;
    label: string;
    delta: string;
  };
};

/* ----------------------------- Tokens ------------------------------ */

const tone = {
  critical: {
    text: "rgb(232,150,150)",
    bg: "rgba(220,90,90,0.06)",
    border: "rgba(220,90,90,0.18)",
    dot: "rgba(220,90,90,0.55)",
  },
  watch: {
    text: "rgb(232,196,124)",
    bg: "rgba(212,168,96,0.06)",
    border: "rgba(212,168,96,0.18)",
    dot: "rgba(212,168,96,0.55)",
  },
  stable: {
    text: "rgb(120,220,196)",
    bg: "rgba(46,211,183,0.06)",
    border: "rgba(46,211,183,0.18)",
    dot: "rgba(46,211,183,0.55)",
  },
} as const;

/* ---------------------------- Mock-Impuls --------------------------- */

const PROMPT: DiagPrompt = {
  id: "mc-lf5-transfer-01",
  competency: "Transferargumentation · Bewertungslogik",
  competencyId: "lf5-transfer",
  field: "LF5 · Steuerung & Kontrolle",
  riskBefore: "critical",
  stateBefore: "instabil seit 9 Tagen",
  examRelevance: "hoch · regelmäßig in schriftlicher + mündlicher Prüfung",
  typicalLoss: "Begründung kommt zu spät · Praxisbezug fehlt",
  selectionReason:
    "Dein kritischster Punktverlust-Cluster. Stabilität in den letzten 3 MiniChecks unverändert.",
  question:
    "Ein Unternehmen senkt den Verkaufspreis um 8 %, obwohl die Deckungsbeiträge bereits unter Plan liegen. Welche Konsequenz hätte diese Entscheidung — und wie würden Sie sie gegenüber der Geschäftsleitung begründen?",
  options: [
    {
      id: "a",
      label:
        "Der Umsatz steigt kurzfristig, weil mehr Stückzahlen verkauft werden — das entlastet die Liquidität.",
      quality: "weak",
    },
    {
      id: "b",
      label:
        "Der Deckungsbeitrag sinkt weiter; ohne Mengeneffekt gefährdet das die Fixkostendeckung. Begründung über Break-Even-Verschiebung.",
      quality: "strong",
    },
    {
      id: "c",
      label:
        "Die Maßnahme ist vertretbar, solange die variablen Kosten konstant bleiben — Marktanteil hat Vorrang.",
      quality: "partial",
    },
  ],
  examinerNote:
    "Ein Prüfer würde hier nach der konkreten Auswirkung auf den Break-Even fragen — und ob Sie eine Alternative benennen können.",
  tutorDebrief:
    "Die Antwort war fachlich tragfähig, aber die Begründung kommt zu spät. In der mündlichen Prüfung würde ein Prüfer hier nachhaken.",
  stateAfter: (q) => {
    if (q === "strong")
      return {
        risk: "watch",
        label: "Transferargumentation leicht stabiler",
        delta: "kritisch → beobachtet",
      };
    if (q === "partial")
      return {
        risk: "critical",
        label: "Transferargumentation weiterhin instabil",
        delta: "kritisch · unverändert",
      };
    return {
      risk: "critical",
      label: "Punktverlust-Risiko weiterhin erhöht",
      delta: "kritisch · vertieft",
    };
  },
};

const MEMORY: { when: string; text: string; tone: RiskTone }[] = [
  { when: "vor 6 Tagen", text: "LF5 · Transferargumentation als kritisch markiert", tone: "critical" },
  { when: "vor 3 Tagen", text: "Praxisbezug zuletzt rückläufig", tone: "watch" },
  { when: "gestern", text: "Mündliche Reaktion auf LF5-Fragen stabiler", tone: "stable" },
];

/* ----------------------------- Helpers ----------------------------- */

const fadeUp = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
};

function StageDot({ t }: { t: RiskTone }) {
  return (
    <span className="relative inline-flex h-2 w-2">
      <span
        className="absolute inset-0 rounded-full animate-ping"
        style={{ background: tone[t].dot, opacity: 0.45 }}
      />
      <span
        className="relative h-2 w-2 rounded-full"
        style={{ background: tone[t].dot }}
      />
    </span>
  );
}

function RiskChip({ t, children }: { t: RiskTone; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] tracking-wide"
      style={{
        background: tone[t].bg,
        color: tone[t].text,
        border: `1px solid ${tone[t].border}`,
      }}
    >
      <StageDot t={t} />
      {children}
    </span>
  );
}

/* ----------------------------- Surface ----------------------------- */

export default function AppMiniCheckPage() {
  const { competencyId } = useParams();
  const system = useSystemConsciousness();
  const [stage, setStage] = useState<Stage>("pre");
  const [pick, setPick] = useState<DiagPrompt["options"][number] | null>(null);
  const [recalcPulse, setRecalcPulse] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const wroteRef = useRef(false);

  // Ruhiger Fokus-Timer (kein Druck-Countdown)
  useEffect(() => {
    if (stage !== "question") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [stage]);

  // Periodisches Recalc-Pulsen (stille Systemaktivität)
  useEffect(() => {
    const t = setInterval(() => {
      setRecalcPulse(true);
      setTimeout(() => setRecalcPulse(false), 1800);
    }, 32000);
    return () => clearInterval(t);
  }, []);

  const stateAfter = useMemo(
    () => (pick ? PROMPT.stateAfter(pick.quality) : null),
    [pick]
  );

  // Cross-Surface-Sync: bei reflect den globalen Prüfungszustand neu bewerten
  useEffect(() => {
    if (stage !== "reflect" || !pick || !stateAfter || wroteRef.current) return;
    wroteRef.current = true;
    const tone = stateAfter.risk;
    system.updateRisk("antwortstruktur", {
      label:
        tone === "stable"
          ? "Antwortstruktur zuletzt stabiler"
          : tone === "watch"
          ? "Antwortstruktur unter Belastung schwankend"
          : "Antwortstruktur strukturell instabil",
      tone,
    });
    if (pick.quality === "strong") {
      system.updateRisk("transfer_argumentation", {
        label: "Transferargumentation zuletzt belastbarer",
        tone: "watch",
      });
    }
    // Phase 6 — Verhaltens-Signale aus dem Pick + Bearbeitungszeit ableiten
    const timePressure = Math.min(1, Math.max(0, (elapsed - 25) / 45));
    const hesitation = Math.min(1, Math.max(0, (elapsed - 10) / 35));
    const confidence =
      pick.quality === "strong" ? 0.85 : pick.quality === "partial" ? 0.55 : 0.3;
    const structure =
      pick.quality === "strong" ? 0.8 : pick.quality === "partial" ? 0.55 : 0.35;
    system.recordSignal("timePressure", timePressure, 0.35);
    system.recordSignal("hesitation", hesitation, 0.35);
    system.recordSignal("confidence", confidence, 0.4);
    system.recordSignal("structureStability", structure, 0.4);

    system.remember(
      `MiniCheck · ${PROMPT.competency}: ${stateAfter.label}`,
      "MiniCheck",
      tone
    );
    const delta = pick.quality === "strong" ? 2 : pick.quality === "partial" ? 0 : -1;
    system.setReadiness(system.readiness + delta);
    system.recalc(
      pick.quality === "weak" && timePressure > 0.5
        ? "Zeitdruck-Risiko erhöht"
        : pick.quality === "strong"
        ? "Transferstabilität neu bewertet"
        : "Prüfungszustand aktualisiert"
    );
  }, [stage, pick, stateAfter, elapsed, system]);

  function handlePick(o: DiagPrompt["options"][number]) {
    if (pick) return;
    setPick(o);
    setStage("analyzing");
    // Deliberative Analysephase — bewusst nicht instant
    setTimeout(() => setStage("reflect"), 2200);
  }


  return (
    <div
      className="relative min-h-screen text-text-primary"
      style={{
        background:
          "radial-gradient(1200px 600px at 50% -10%, rgba(46,211,183,0.06), transparent 60%), radial-gradient(900px 500px at 100% 100%, rgba(40,90,140,0.10), transparent 60%), hsl(var(--background))",
      }}
    >
      {/* Aura — passt sich Risiko an */}
      <BackgroundAura t={stateAfter?.risk ?? PROMPT.riskBefore} />

      <div className="relative mx-auto w-full max-w-2xl px-5 pt-8 pb-32">
        {/* System-Strip */}
        <SystemStrip recalcPulse={recalcPulse} elapsed={elapsed} stage={stage} />

        {/* Stage: PRE — diagnostischer Kontext */}
        <AnimatePresence mode="wait">
          {stage === "pre" && (
            <motion.section key="pre" {...fadeUp} className="mt-8">
              <PreCheck onStart={() => setStage("question")} />
            </motion.section>
          )}

          {stage === "question" && (
            <motion.section key="q" {...fadeUp} className="mt-8">
              <QuestionStage onPick={handlePick} pick={pick} />
            </motion.section>
          )}

          {stage === "analyzing" && (
            <motion.section key="ana" {...fadeUp} className="mt-8">
              <AnalyzingStage />
            </motion.section>
          )}

          {stage === "reflect" && stateAfter && pick && (
            <motion.section key="ref" {...fadeUp} className="mt-8">
              <ReflectStage
                pick={pick}
                stateAfter={stateAfter}
                onContinue={() => setStage("summary")}
              />
            </motion.section>
          )}

          {stage === "summary" && stateAfter && (
            <motion.section key="sum" {...fadeUp} className="mt-8">
              <SummaryStage stateAfter={stateAfter} />
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* --------------------------- Background Aura --------------------------- */

function BackgroundAura({ t }: { t: RiskTone }) {
  const color =
    t === "critical"
      ? "rgba(220,90,90,0.08)"
      : t === "watch"
        ? "rgba(212,168,96,0.07)"
        : "rgba(46,211,183,0.09)";
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      animate={{ opacity: [0.7, 1, 0.7] }}
      transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      style={{
        background: `radial-gradient(800px 400px at 50% 0%, ${color}, transparent 70%)`,
      }}
    />
  );
}

/* ----------------------------- System Strip ---------------------------- */

function SystemStrip({
  recalcPulse,
  elapsed,
  stage,
}: {
  recalcPulse: boolean;
  elapsed: number;
  stage: Stage;
}) {
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-border-subtle bg-surface-raised">
          <Radar className="h-3.5 w-3.5 text-text-secondary" />
        </div>
        <div className="text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
          Diagnostischer Prüfungsimpuls
        </div>
      </div>
      <div className="flex items-center gap-2">
        {stage === "question" && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-raised px-2 py-0.5 text-[11px] tabular-nums text-text-secondary">
            <Clock className="h-3 w-3" />
            {mm}:{ss}
          </span>
        )}
        <motion.span
          animate={{ opacity: recalcPulse ? 1 : 0.55 }}
          transition={{ duration: 0.6 }}
          className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-raised px-2 py-0.5 text-[11px] text-text-secondary"
        >
          <Cpu className="h-3 w-3" />
          {recalcPulse ? "Prüfungszustand aktualisiert" : "System beobachtet"}
        </motion.span>
      </div>
    </div>
  );
}

/* ------------------------------- Pre Check ----------------------------- */

function PreCheck({ onStart }: { onStart: () => void }) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface-raised/70 p-6 shadow-elev-2 backdrop-blur-sm sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
            {PROMPT.field}
          </div>
          <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            Stabilitätsprüfung: {PROMPT.competency}
          </h1>
        </div>
        <RiskChip t={PROMPT.riskBefore}>{PROMPT.stateBefore}</RiskChip>
      </div>

      <p className="mt-4 text-sm text-text-secondary">
        Dieser Impuls wurde nicht zufällig gewählt. Das System überprüft, ob sich
        deine kritischsten Schwächen stabilisieren.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <ContextRow icon={<Target className="h-4 w-4" />} label="Prüfungsrelevanz">
          {PROMPT.examRelevance}
        </ContextRow>
        <ContextRow icon={<Gauge className="h-4 w-4" />} label="Typische Punktverluste">
          {PROMPT.typicalLoss}
        </ContextRow>
        <ContextRow icon={<History className="h-4 w-4" />} label="Letzter Stabilitätsstatus">
          {PROMPT.stateBefore}
        </ContextRow>
        <ContextRow icon={<Sparkles className="h-4 w-4" />} label="Auswahlbegründung">
          {PROMPT.selectionReason}
        </ContextRow>
      </div>

      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-[12px] text-text-tertiary">
          Ein Impuls. Eine Antwort. Eine Reevaluation deines Prüfungszustands.
        </div>
        <button
          onClick={onStart}
          data-testid="minicheck-start"
          className="group inline-flex items-center justify-center gap-2 rounded-xl border border-border-subtle bg-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-elev-2 transition hover:shadow-elev-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Impuls starten
          <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}

function ContextRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface-sunken/60 p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm text-text-primary">{children}</div>
    </div>
  );
}

/* ------------------------------ Question ------------------------------ */

function QuestionStage({
  onPick,
  pick,
}: {
  onPick: (o: DiagPrompt["options"][number]) => void;
  pick: DiagPrompt["options"][number] | null;
}) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface-raised/70 p-6 shadow-elev-2 backdrop-blur-sm sm:p-8">
      <div className="flex items-center gap-2">
        <RiskChip t={PROMPT.riskBefore}>{PROMPT.competency}</RiskChip>
      </div>
      <h2 className="mt-5 text-xl font-medium leading-snug text-text-primary sm:text-[22px]">
        {PROMPT.question}
      </h2>

      <div className="mt-6 flex flex-col gap-3">
        {PROMPT.options.map((o) => {
          const selected = pick?.id === o.id;
          return (
            <button
              key={o.id}
              disabled={!!pick}
              onClick={() => onPick(o)}
              className={`group flex items-start gap-3 rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                selected
                  ? "border-primary/50 bg-primary/[0.06]"
                  : "border-border-subtle bg-surface hover:border-primary/40 hover:bg-primary/[0.03]"
              }`}
            >
              <CircleDot
                className={`mt-0.5 h-4 w-4 shrink-0 ${
                  selected ? "text-primary" : "text-text-tertiary"
                }`}
              />
              <span className="text-[15px] leading-relaxed text-text-primary">
                {o.label}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-5 text-[12px] text-text-tertiary">
        Es geht nicht um „richtig oder falsch“. Es geht um die Struktur deiner
        Begründung.
      </p>
    </div>
  );
}

/* ---------------------------- Analyzing Stage --------------------------- */

function AnalyzingStage() {
  const lines = [
    "Antwort wird analysiert …",
    "Argumentationsstruktur wird bewertet …",
    "Risiko wird neu eingeschätzt …",
    "Prüfungszustand wird aktualisiert …",
  ];
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface-raised/70 p-8 shadow-elev-2 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border-subtle bg-surface"
        >
          <Brain className="h-4 w-4 text-text-secondary" />
        </motion.div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
            Deliberative Auswertung
          </div>
          <div className="text-sm text-text-primary">
            Das System bewertet deinen Zustand.
          </div>
        </div>
      </div>
      <ul className="mt-6 space-y-2">
        {lines.map((l, i) => (
          <motion.li
            key={l}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.45, duration: 0.5 }}
            className="flex items-center gap-2 text-[13px] text-text-secondary"
          >
            <Waves className="h-3.5 w-3.5 text-text-tertiary" />
            {l}
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------- Reflect Stage --------------------------- */

function ReflectStage({
  pick,
  stateAfter,
  onContinue,
}: {
  pick: DiagPrompt["options"][number];
  stateAfter: ReturnType<DiagPrompt["stateAfter"]>;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Zustandsveränderung */}
      <div className="rounded-2xl border border-border-subtle bg-surface-raised/70 p-6 shadow-elev-2 backdrop-blur-sm sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
            Reevaluierter Prüfungszustand
          </div>
          <RiskChip t={stateAfter.risk}>{stateAfter.delta}</RiskChip>
        </div>
        <h3 className="mt-3 text-xl font-medium leading-snug text-text-primary sm:text-[22px]">
          {stateAfter.label}
        </h3>

        <div className="mt-5 rounded-xl border border-border-subtle bg-surface-sunken/60 p-4">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            <Activity className="h-3.5 w-3.5" />
            Prüfer-Perspektive
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-text-primary">
            {PROMPT.examinerNote}
          </p>
        </div>
      </div>

      {/* Tutor-Debrief */}
      <div className="rounded-2xl border border-border-subtle bg-surface-raised/70 p-6 shadow-elev-2 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
          <Brain className="h-3.5 w-3.5" />
          Tutor · Diagnostischer Interpret
        </div>
        <p className="mt-2 text-[15px] leading-relaxed text-text-primary">
          {PROMPT.tutorDebrief}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            to="/app/tutor"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[12px] text-text-secondary transition hover:bg-surface-raised"
          >
            Im Tutor vertiefen <ChevronRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            to="/app/oral"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[12px] text-text-secondary transition hover:bg-surface-raised"
          >
            Mündlich nachstellen <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* System Memory */}
      <div className="rounded-2xl border border-border-subtle bg-surface-raised/70 p-6 shadow-elev-2 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
          <History className="h-3.5 w-3.5" />
          System-Memory · {PROMPT.competency}
        </div>
        <ul className="mt-3 space-y-2.5">
          {MEMORY.map((m) => (
            <li key={m.text} className="flex items-center gap-3 text-[13px]">
              <StageDot t={m.tone} />
              <span className="w-24 shrink-0 text-text-tertiary">{m.when}</span>
              <span className="text-text-secondary">{m.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onContinue}
          className="inline-flex items-center gap-2 rounded-xl border border-border-subtle bg-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-elev-2 transition hover:shadow-elev-3"
        >
          Reevaluation abschließen
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/* ----------------------------- Summary Stage --------------------------- */

function SummaryStage({
  stateAfter,
}: {
  stateAfter: ReturnType<DiagPrompt["stateAfter"]>;
}) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface-raised/70 p-6 shadow-elev-2 backdrop-blur-sm sm:p-8">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Impuls abgeschlossen
      </div>
      <h2 className="mt-2 text-2xl font-semibold leading-tight">
        Zustand reevaluiert
      </h2>
      <p className="mt-3 text-sm text-text-secondary">
        Dein Prüfungszustand wurde aktualisiert. Das System leitet den nächsten
        Stabilisierungsschritt aus deinem aktuellen Risiko ab.
      </p>

      <div className="mt-5 rounded-xl border border-border-subtle bg-surface-sunken/60 p-4">
        <div className="text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          Aktuelle Beobachtung
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <div className="text-[15px] text-text-primary">{stateAfter.label}</div>
          <RiskChip t={stateAfter.risk}>{stateAfter.delta}</RiskChip>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          to="/app/lernpfad"
          className="inline-flex items-center gap-1.5 rounded-xl border border-border-subtle bg-surface px-4 py-2.5 text-[13px] text-text-secondary transition hover:bg-surface-raised"
        >
          Strategie ansehen <ChevronRight className="h-4 w-4" />
        </Link>
        <Link
          to="/app/kompetenz/lf5-transfer"
          className="inline-flex items-center gap-1.5 rounded-xl border border-border-subtle bg-surface px-4 py-2.5 text-[13px] text-text-secondary transition hover:bg-surface-raised"
        >
          Kompetenz öffnen <ChevronRight className="h-4 w-4" />
        </Link>
        <Link
          to="/app/minicheck"
          className="inline-flex items-center gap-1.5 rounded-xl border border-border-subtle bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-foreground transition hover:shadow-elev-3"
          onClick={() => {
            if (typeof window !== "undefined") setTimeout(() => window.location.reload(), 40);
          }}
        >
          Nächsten Impuls starten <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
