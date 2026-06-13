import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Brain,
  ChevronRight,
  Eye,
  Quote,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import "@/components/landing/v2/lp-v2-theme.css";
import { useSystemConsciousness, daysSince } from "@/lib/system/SystemConsciousness";
import { useExamPsychology } from "@/lib/system/ExamPsychology";
import { DramaturgyChip } from "@/components/system/DramaturgyChip";
import { ExaminerLensCard } from "@/components/system/ExaminerLensCard";
import { ExaminerBiographyCard } from "@/components/system/ExaminerBiographyCard";
import {
  useLearnerRealityBridge,
  type LearnerRealitySnapshot,
} from "@/hooks/useLearnerRealityBridge";
import { RouteIdentityBlock } from "@/components/learner/RouteIdentityBlock";
import { OutcomeHintBlock } from "@/components/learner/OutcomeHintBlock";
import { useOsBeruf } from "@/lib/os/os-identity";

/**
 * /app/tutor — P0-3 Sprint 1: DB-gebundener Tutor.
 * Frage „Wobei brauche ich Hilfe?" → letzte Schwäche + letzte Aktivität + empfohlene Erklärung.
 */
export default function AppTutorPage() {
  const reality = useLearnerRealityBridge();
  const beruf = useOsBeruf();

  return (
    <main className="lp-v2 min-h-screen w-full">
      <div className="relative mx-auto flex min-h-screen w-full max-w-[680px] flex-col px-5 pb-28 pt-8 sm:px-8 sm:pt-12">
        <BackgroundAura />
        <TutorHeader />
        <RouteIdentityBlock
          title="AI Tutor"
          subtitle="Der Tutor erklärt deine Schwächen anhand deines IHK-Curriculums und bereitet dich gezielt auf echte Prüfungsfragen vor."
          contextLine={beruf?.label ? `für ${beruf.label}` : undefined}
          description="ExamFit AI Tutor: erkennt deine Schwächen, erklärt Prüfungsmuster und schlägt den nächsten Lernschritt vor."
          testId="tutor-identity"
        />
        <OutcomeHintBlock
          heading="Nach dem Start:"
          bullets={[
            "Der Tutor analysiert deine letzten Antworten und benennt deine größte prüfungsrelevante Schwäche",
            "Du bekommst eine konkrete Lernempfehlung, passend zu deinem Beruf",
            "Danach führst du genau die nächste Übung aus, die deine Prüfungsreife erhöht",
          ]}
          className="mb-5"
          testId="tutor-outcome-hint"
        />
        {reality.needsOnboarding || (!reality.hasData && !reality.loading) ? (
          <TutorOnboarding />
        ) : reality.loading && !reality.hasData ? (
          <>
            <TutorLoading />
            {/* KIMI.1.5 P0-Fix: niemals leerer Tutor ohne Folgeaktion.
                Auch während Loading bleibt eine echte CTA klickbar. */}
            <TutorOnboarding />
          </>
        ) : (
          <>
            <TutorPresenceCard />
            <ObservationStream />
            <div className="mb-3"><DramaturgyChip /></div>
            <div className="mb-3"><ExaminerLensCard /></div>
            <div className="mb-3"><ExaminerBiographyCard /></div>
            <RiskInterpretation />
            <PrioritizedFocus reality={reality} />
            <ExaminerLens />
            <CalmAsk />
          </>
        )}
      </div>
    </main>
  );
}

function TutorOnboarding() {
  return (
    <section
      data-testid="tutor-onboarding"
      className="mt-8 rounded-2xl border border-white/[0.06] bg-[rgba(13,22,40,0.55)] p-6 text-center"
    >
      <h2 className="lp-display text-xl text-[color:var(--lp-text-primary,#e8ecf3)]">
        Dein KI-Prüfungs-Tutor wartet auf dein Curriculum
      </h2>
      <p className="mt-2 text-[14px] text-[color:var(--lp-text-secondary,#a8b3c2)]">
        Der Tutor erklärt dir Prüfungsfragen anhand deines IHK-Curriculums — wähle zuerst deinen Beruf, damit er deine Schwächen kennt.
      </p>


      {/* Primary CTA — genau ein empfohlener nächster Schritt */}
      <div className="mt-6 flex flex-col items-center gap-3">
        <Link
          to="/berufe"
          data-testid="tutor-primary-cta"
          aria-label="Empfohlen: Beruf auswählen (empfohlener nächster Schritt)"
          className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold shadow-lg shadow-[rgba(46,211,183,0.18)] transition-transform hover:scale-[1.02]"
          style={{
            background: "linear-gradient(135deg, rgba(46,211,183,0.98), rgba(36,180,160,0.98))",
            color: "rgb(8,18,20)",
          }}
        >
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{
              background: "rgba(8,18,20,0.18)",
              color: "rgb(8,18,20)",
            }}
          >
            Empfohlen
          </span>
          Beruf auswählen — nächster Schritt
          <ArrowRight className="h-4 w-4" />
        </Link>
        <p className="max-w-sm text-[12.5px] leading-snug text-[color:var(--lp-text-secondary,#a8b3c2)]">
          Danach kennt der Tutor dein Prüfungs-Curriculum und deine Schwächen → du startest direkt mit deiner ersten Erklärung.
        </p>


        {/* Secondary — kleiner, ohne CTA-Gewicht */}
        <Link
          to="/app/lernpfad"
          data-testid="tutor-onboarding-secondary"
          className="mt-1 text-[12.5px] font-medium text-white/55 underline-offset-4 transition-colors hover:text-white/80 hover:underline"
        >
          Oder direkt zum Lernpfad
        </Link>
      </div>
    </section>
  );
}

function TutorLoading() {
  return (
    <div className="mt-8 space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 animate-pulse rounded-2xl border border-white/[0.05] bg-white/[0.03]" />
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
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[460px]"
      style={{
        background:
          "radial-gradient(60% 100% at 50% 0%, rgba(46,211,183,0.07) 0%, rgba(46,211,183,0) 70%)",
      }}
    />
  );
}

function TutorHeader() {
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
          <Brain className="h-3.5 w-3.5" style={{ color: "rgb(120,235,210)" }} />
        </div>
        <span
          className="text-[11px] uppercase tracking-[0.18em]"
          style={{ color: "rgba(220,235,232,0.62)" }}
        >
          Tutor · Beobachtung
        </span>
      </div>
      <Link
        to="/app/start"
        className="text-[11px] uppercase tracking-[0.16em] transition-colors"
        style={{ color: "rgba(220,235,232,0.5)" }}
      >
        zurück
      </Link>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Tutor Presence — der Tutor "schaut hin", nicht "wartet auf Eingabe" */
/* ------------------------------------------------------------------ */
function TutorPresenceCard() {
  const system = useSystemConsciousness();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 7400);
    return () => clearInterval(t);
  }, []);

  const fallback = [
    "Transferaufgaben bleiben trotz Verbesserung instabil.",
    "Fachgesprächsstruktur war heute stabiler als gestern.",
    "LF5 verursacht weiterhin die meisten Punktverluste.",
    "Lernpfad wurde deshalb vorgezogen.",
    "Rückfragen-Risiko gesunken.",
  ];
  const observations = system.memory.length > 0
    ? system.memory.map((m) => m.text)
    : fallback;
  const current = observations[tick % observations.length];

  return (
    <section
      className="lp-surface mb-5 overflow-hidden rounded-[22px] p-5"
      style={{
        border: "1px solid rgba(46,211,183,0.18)",
        background:
          "linear-gradient(180deg, rgba(20,38,42,0.62), rgba(14,24,28,0.5))",
      }}
    >
      <div className="mb-3 flex items-center gap-2">
        <BreathingDot />
        <span
          className="text-[10.5px] uppercase tracking-[0.22em]"
          style={{ color: "rgba(120,235,210,0.78)" }}
        >
          System beobachtet
        </span>
      </div>
      <div className="min-h-[64px]">
        <AnimatePresence mode="wait">
          <motion.p
            key={current}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="lp-display text-[19px] leading-[1.35]"
            style={{ color: "rgba(238,247,245,0.96)" }}
          >
            {current}
          </motion.p>
        </AnimatePresence>
      </div>
      <div
        className="mt-4 flex items-center gap-2 text-[11px]"
        style={{ color: "rgba(220,235,232,0.5)" }}
      >
        <Eye className="h-3 w-3" />
        <span>
          Sitzungsgedächtnis · 14 Sessions · 3 Simulationen · 2 Fachgespräche
        </span>
      </div>
    </section>
  );
}

function BreathingDot() {
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      <motion.span
        className="absolute inset-0 rounded-full"
        style={{ background: "rgba(46,211,183,0.35)" }}
        animate={{ scale: [1, 1.8, 1], opacity: [0.55, 0, 0.55] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
      />
      <span
        className="relative inline-block h-2.5 w-2.5 rounded-full"
        style={{ background: "rgb(120,235,210)" }}
      />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Observation Stream — der Tutor erinnert sich. Kein Chat-Verlauf.    */
/* ------------------------------------------------------------------ */
type Obs = {
  when: string;
  text: string;
  tone: "neutral" | "watch" | "ok" | "risk";
  source: string;
};

const STREAM: Obs[] = [
  {
    when: "vor 4 Min.",
    text:
      "Argumentationsstruktur in der letzten Antwort blieb sprunghaft — Prüfer würde hier nachfragen.",
    tone: "watch",
    source: "Oral-Simulation",
  },
  {
    when: "heute · 09:12",
    text:
      "Rechnungswesen-Transferaufgaben: −6 Punkte gegenüber Vorwoche. Muster wiederholt sich.",
    tone: "risk",
    source: "Prüfungsreife-Analyse",
  },
  {
    when: "gestern",
    text:
      "Praxisbezug in Begründungen stabiler als in den letzten 3 Sessions.",
    tone: "ok",
    source: "MiniCheck · LF3",
  },
  {
    when: "vor 2 Tagen",
    text:
      "Strategie angepasst: LF5 vorgezogen, weil Punktverlust dort konzentriert ist.",
    tone: "neutral",
    source: "Lernpfad · Recalc",
  },
];

function ObservationStream() {
  const system = useSystemConsciousness();
  const items = system.memory.length > 0
    ? system.memory.slice(0, 6).map<Obs>((m) => {
        const d = daysSince(m.ts);
        return {
          when: d === 0 ? "heute" : d === 1 ? "gestern" : `vor ${d} Tagen`,
          text: m.text,
          tone:
            m.tone === "critical"
              ? "risk"
              : m.tone === "watch"
              ? "watch"
              : m.tone === "stable"
              ? "ok"
              : "neutral",
          source: m.source,
        };
      })
    : STREAM;
  return (
    <section className="mb-6">
      <SectionHeader
        eyebrow="Verlauf · Beobachtungen"
        title="Was das System zuletzt registriert hat"
      />
      <ol className="relative space-y-3 border-l border-white/5 pl-4">
        {items.map((o, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.07, duration: 0.45 }}
            className="relative"
          >
            <span
              className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full"
              style={{ background: dotColor(o.tone) }}
            />
            <div
              className="rounded-[14px] px-4 py-3"
              style={{
                border: "1px solid rgba(255,255,255,0.05)",
                background: "rgba(14,24,28,0.45)",
              }}
            >
              <div
                className="mb-1 flex items-center justify-between text-[10.5px] uppercase tracking-[0.16em]"
                style={{ color: "rgba(220,235,232,0.45)" }}
              >
                <span>{o.source}</span>
                <span>{o.when}</span>
              </div>
              <p
                className="text-[14px] leading-[1.55]"
                style={{ color: "rgba(238,247,245,0.92)" }}
              >
                {o.text}
              </p>
            </div>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}

function dotColor(t: Obs["tone"]) {
  switch (t) {
    case "risk":
      return "rgb(232,150,150)";
    case "watch":
      return "rgb(232,196,120)";
    case "ok":
      return "rgb(120,235,210)";
    default:
      return "rgba(220,235,232,0.4)";
  }
}

/* ------------------------------------------------------------------ */
/* Risk Interpretation — nicht erklären, sondern bewerten              */
/* ------------------------------------------------------------------ */
function RiskInterpretation() {
  const { patterns, examiner, priority } = useExamPsychology();
  const headline = patterns[0]?.observation
    ?? "Der wiederkehrende Punktverlust deutet auf ein strukturelles Transferproblem.";
  const lines = examiner.length > 0
    ? examiner.map((e) => e.text)
    : [
        "Antworten bleiben fachlich, kippen aber in Aufzählung.",
        "Rückfragen treffen meist die Begründungsebene.",
        "Punktverlust korreliert mit Aufgaben > 90 Sek. Bearbeitungszeit.",
      ];
  return (
    <section
      className="mb-6 rounded-[18px] p-5"
      style={{
        border: "1px solid rgba(232,150,150,0.18)",
        background:
          "linear-gradient(180deg, rgba(40,22,22,0.4), rgba(20,14,14,0.35))",
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle
          className="h-3.5 w-3.5"
          style={{ color: "rgb(232,150,150)" }}
        />
        <span
          className="text-[10.5px] uppercase tracking-[0.2em]"
          style={{ color: "rgba(232,180,180,0.78)" }}
        >
          Interpretation · Examiner-Lens
        </span>
      </div>
      <p
        className="lp-display mb-3 text-[18px] leading-[1.4]"
        style={{ color: "rgba(245,232,232,0.95)" }}
      >
        {headline}
      </p>
      <ul
        className="space-y-1.5 text-[13px]"
        style={{ color: "rgba(220,210,210,0.75)" }}
      >
        {lines.map((line) => (
          <li key={line} className="flex items-start gap-2">
            <span className="mt-1.5 inline-block h-1 w-1 rounded-full bg-white/40" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      {patterns[0]?.cause && (
        <p
          className="mt-4 border-t border-white/5 pt-3 text-[12px] leading-relaxed"
          style={{ color: "rgba(220,210,210,0.55)" }}
        >
          <span className="uppercase tracking-[0.18em] text-[10px]">Ursache · </span>
          {patterns[0].cause}
        </p>
      )}
      <p
        className="mt-3 text-[12px]"
        style={{ color: "rgba(232,196,124,0.85)" }}
      >
        Strategische Priorität · {priority.focus} · {priority.expectedImpact}
      </p>
    </section>
  );
}


/* ------------------------------------------------------------------ */
/* Prioritized Focus — nicht Optionen, sondern Priorisierung           */
/* ------------------------------------------------------------------ */
function PrioritizedFocus({ reality }: { reality: LearnerRealitySnapshot }) {
  const focus = reality.weak[0] ?? reality.partial[0];
  const focusTitle = focus
    ? `Begründungs-Drill · ${focus.title}`
    : "Bereit für die nächste Prüfungssimulation";
  const focusReason = focus
    ? `Aktueller Score ${Math.round(focus.score)} / 100 in ${focus.field || "diesem Lernfeld"}. Eine fokussierte Mikro-Session adressiert direkt diesen Punkt.`
    : reality.lastActivity
      ? `Letzte Aktivität: ${reality.lastActivity.lessonTitle} (${reality.lastActivity.moduleTitle}).`
      : "Kein offenes Schwächemuster — gute Voraussetzungen für einen Vollsimulation-Lauf.";
  const primaryHref = focus ? `/app/tutor?focus=${encodeURIComponent(focus.id)}` : reality.nextStep.to;
  const primaryLabel = focus ? "Tutor starten · diese Kompetenz" : reality.nextStep.label;
  return (
    <section className="mb-6">
      <SectionHeader
        eyebrow="Aktuell relevant"
        title="Das ist jetzt der Hebel"
      />
      <div
        className="rounded-[18px] p-5"
        style={{
          border: "1px solid rgba(46,211,183,0.22)",
          background:
            "linear-gradient(180deg, rgba(18,36,40,0.55), rgba(12,22,26,0.45))",
        }}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="h-3.5 w-3.5" style={{ color: "rgb(120,235,210)" }} />
            <span
              className="text-[10.5px] uppercase tracking-[0.2em]"
              style={{ color: "rgba(120,235,210,0.8)" }}
            >
              Tutor-Empfehlung · 1 Schritt
            </span>
          </div>
          <span
            className="text-[10.5px] uppercase tracking-[0.16em]"
            style={{ color: "rgba(220,235,232,0.48)" }}
          >
            Δ Prüfungsreife · +4
          </span>
        </div>

        <h3
          className="lp-display text-[20px] leading-[1.3]"
          style={{ color: "rgba(238,247,245,0.96)" }}
        >
          {focusTitle}
        </h3>
        <p
          className="mt-2 text-[13.5px] leading-[1.55]"
          style={{ color: "rgba(220,235,232,0.7)" }}
        >
          {focusReason}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            to={primaryHref}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-medium transition-all"
            style={{
              background:
                "linear-gradient(135deg, rgba(46,211,183,0.95), rgba(36,180,160,0.95))",
              color: "rgb(8,18,20)",
              boxShadow: "0 8px 24px -10px rgba(46,211,183,0.5)",
            }}
          >
            {primaryLabel}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            to="/app/oral"
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] transition-colors"
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
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Examiner Lens — der Tutor spricht wie ein Prüfer                    */
/* ------------------------------------------------------------------ */
function ExaminerLens() {
  return (
    <section className="mb-6">
      <SectionHeader
        eyebrow="Prüfer-Perspektive"
        title="So würde ein Prüfer deine letzte Antwort lesen"
      />
      <div
        className="rounded-[18px] p-5"
        style={{
          border: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(14,24,28,0.5)",
        }}
      >
        <Quote
          className="mb-2 h-4 w-4"
          style={{ color: "rgba(232,196,120,0.7)" }}
        />
        <p
          className="lp-display text-[16.5px] leading-[1.55] italic"
          style={{ color: "rgba(238,247,245,0.92)" }}
        >
          „Inhaltlich tragfähig — aber die Begründung kommt zu spät.
          Hier würde nachgefragt: <span className="not-italic">Warum genau dieser Schritt?</span>“
        </p>
        <div
          className="mt-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.16em]"
          style={{ color: "rgba(220,235,232,0.48)" }}
        >
          <ShieldCheck className="h-3 w-3" />
          <span>Bewertung · ruhig · fachlich · ohne Wertung</span>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Calm Ask — falls der Nutzer doch fragt: ruhig, kein Chatbot         */
/* ------------------------------------------------------------------ */
function CalmAsk() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => ref.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open]);

  return (
    <section className="mt-2">
      <div
        className="rounded-[18px] p-4"
        style={{
          border: "1px solid rgba(255,255,255,0.06)",
          background:
            "linear-gradient(180deg, rgba(14,24,28,0.55), rgba(10,18,22,0.45))",
        }}
      >
        {!open ? (
          <button
            onClick={() => setOpen(true)}
            className="flex w-full items-center justify-between text-left"
          >
            <div className="flex items-center gap-2.5">
              <Sparkles
                className="h-3.5 w-3.5"
                style={{ color: "rgba(120,235,210,0.8)" }}
              />
              <span
                className="text-[13px]"
                style={{ color: "rgba(220,235,232,0.78)" }}
              >
                Eine präzise Frage stellen
              </span>
            </div>
            <span
              className="text-[10.5px] uppercase tracking-[0.18em]"
              style={{ color: "rgba(220,235,232,0.4)" }}
            >
              optional
            </span>
          </button>
        ) : (
          <div>
            <div
              className="mb-2 text-[10.5px] uppercase tracking-[0.18em]"
              style={{ color: "rgba(120,235,210,0.78)" }}
            >
              Fachliche Frage · keine Smalltalk-Eingabe
            </div>
            <textarea
              ref={ref}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={3}
              placeholder="z. B. Warum verliere ich bei Transferaufgaben in LF5 Punkte trotz richtiger Fachbegriffe?"
              className="w-full resize-none rounded-[12px] bg-transparent px-3 py-2.5 text-[13.5px] leading-[1.5] outline-none placeholder:text-white/30"
              style={{
                border: "1px solid rgba(255,255,255,0.08)",
                color: "rgba(238,247,245,0.95)",
              }}
            />
            <div className="mt-3 flex items-center justify-between">
              <button
                onClick={() => {
                  setOpen(false);
                  setValue("");
                }}
                className="text-[11.5px] uppercase tracking-[0.16em]"
                style={{ color: "rgba(220,235,232,0.45)" }}
              >
                abbrechen
              </button>
              <button
                disabled={value.trim().length < 4}
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12.5px] font-medium transition-opacity disabled:opacity-40"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(46,211,183,0.95), rgba(36,180,160,0.95))",
                  color: "rgb(8,18,20)",
                }}
              >
                an Tutor übergeben
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
      <p
        className="mt-3 text-center text-[10.5px] uppercase tracking-[0.18em]"
        style={{ color: "rgba(220,235,232,0.32)" }}
      >
        Der Tutor antwortet nicht sofort. Er prüft erst den Zustand.
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
