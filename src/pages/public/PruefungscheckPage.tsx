import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, ArrowRight, Brain, Cpu, Gauge, Radar, ShieldAlert, Sparkles, Waves } from "lucide-react";
import {
  daysSince,
  readinessLabel,
  riskToneClasses,
  useSystemConsciousness,
  type RiskTone,
} from "@/lib/system/SystemConsciousness";

/**
 * Phase 5.9 — öffentliche diagnostische Erstbewertung.
 *
 * Kein Lead-Magnet-Quiz, kein Schnelltest, kein Freebie. Dies ist die
 * öffentliche Eintrittsfläche des Prüfungsbetriebssystems — die erste
 * Berührung mit dem Systembewusstsein, das in /app/* fortgeführt wird.
 *
 * Schreibt in dieselbe SystemConsciousness (Phase 5.8) — d.h. der Verlauf
 * setzt sich nach Conversion ohne Bruch in den Premium-Surfaces fort.
 */

type Phase = "entry" | "pre" | "question" | "analyzing" | "result";

interface CheckItem {
  id: string;
  domain: string;
  preContext: string;
  prompt: string;
  examinerLens: string;
  // Antwort-Optionen — bewusst prüfungsnah formuliert, nicht "richtig/falsch"
  options: Array<{ id: string; label: string; quality: "weak" | "partial" | "strong" }>;
}

const CHECK: CheckItem[] = [
  {
    id: "transfer",
    domain: "Transferargumentation",
    preContext:
      "Transferargumentation ist aktuell besonders prüfungsrelevant. Viele Prüflinge verlieren hier Punkte unter Zeitdruck.",
    prompt:
      "Welche Konsequenz hätte es, eine halbfertige Leistung am Bilanzstichtag ohne Begründung des Wertansatzes auszuweisen?",
    examinerLens: "Ein Prüfer würde hier nach der Reihenfolge der Begründung fragen.",
    options: [
      { id: "a", label: "Es entstehen keine Konsequenzen, solange der Betrag korrekt ist.", quality: "weak" },
      { id: "b", label: "Die Bewertung wäre nicht nachvollziehbar — Punktverlust bei Begründung.", quality: "partial" },
      { id: "c", label: "Verstoß gegen das Vorsichtsprinzip; Begründung muss strukturell vor dem Ergebnis stehen.", quality: "strong" },
    ],
  },
  {
    id: "rueckfrage",
    domain: "Fachgespräch · Rückfragen",
    preContext:
      "Im Fachgespräch entscheiden Rückfragen über bis zu 30 % der Punkte. Belastbarkeit der Begründung ist diagnostisch relevant.",
    prompt: "Welche Rückfrage wäre nach einer kurzen Bewertungsaussage am wahrscheinlichsten?",
    examinerLens: "Antwortstruktur wird hier mehr beobachtet als der Inhalt.",
    options: [
      { id: "a", label: "Eine Rückfrage zur Definition.", quality: "weak" },
      { id: "b", label: "Eine Rückfrage zum Praxisbezug.", quality: "partial" },
      { id: "c", label: "Eine Rückfrage zur Belastbarkeit der Begründung.", quality: "strong" },
    ],
  },
  {
    id: "praxis",
    domain: "Praxisbezug · LF5",
    preContext: "Relevant für schriftliche Bewertungsaufgaben und Fachgespräch.",
    prompt: "Warum wäre eine rein theoretische Antwort auf eine LF5-Bewertungsfrage problematisch?",
    examinerLens: "Praxisbezug ist hier kein Stilmittel — er ist Bewertungskriterium.",
    options: [
      { id: "a", label: "Sie ist zu kurz.", quality: "weak" },
      { id: "b", label: "Sie zeigt keine Anwendung im betrieblichen Kontext.", quality: "partial" },
      { id: "c", label: "Sie verfehlt das Bewertungskriterium Praxisbezug und löst typische Rückfragen aus.", quality: "strong" },
    ],
  },
];

function toneFromScore(score: number): RiskTone {
  if (score < 0.45) return "critical";
  if (score < 0.75) return "watch";
  return "stable";
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

const RiskChip = ({ tone, label }: { tone: RiskTone; label: string }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${riskToneClasses(
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

export default function PruefungscheckPage() {
  const { slug } = useParams<{ slug?: string }>();
  const { recalc, remember, updateRisk, setReadiness, readiness, topRisks } = useSystemConsciousness();

  const [phase, setPhase] = useState<Phase>("entry");
  const [idx, setIdx] = useState(0);
  const [picks, setPicks] = useState<Array<"weak" | "partial" | "strong">>([]);
  const [signal, setSignal] = useState<string | null>(null);

  const current = CHECK[idx];

  const score = useMemo(() => {
    if (picks.length === 0) return 0.5;
    const v = picks.reduce((acc, q) => acc + (q === "strong" ? 1 : q === "partial" ? 0.5 : 0), 0);
    return v / picks.length;
  }, [picks]);
  const tone = toneFromScore(score);

  // sanfter Recalc bei Eintritt — Systembewusstsein nimmt den Nutzer wahr
  useEffect(() => {
    if (phase === "entry") recalc("Erste Analyse vorbereitet");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startCheck() {
    setPhase("pre");
    setSignal("Analyse aktualisiert");
    recalc("Analyse aktualisiert");
  }

  function toQuestion() {
    setPhase("question");
  }

  function pick(quality: "weak" | "partial" | "strong") {
    setPhase("analyzing");
    setTimeout(() => {
      const next = [...picks, quality];
      setPicks(next);

      // Cross-Surface: in System Consciousness spiegeln
      if (current.id === "transfer") {
        updateRisk("transfer_argumentation", {
          label: quality === "strong" ? "Transferargumentation belastbarer" : "Transferargumentation instabil",
          tone: quality === "strong" ? "watch" : "critical",
        });
      }
      if (current.id === "rueckfrage") {
        updateRisk("rueckfragen_wahrscheinlich", {
          label: quality === "strong" ? "Rückfragen-Risiko reduziert" : "Rückfragen wahrscheinlich",
          tone: quality === "strong" ? "stable" : "watch",
        });
      }
      if (current.id === "praxis") {
        updateRisk("praxisbezug", {
          label: quality === "strong" ? "Praxisbezug stabilisiert" : "Praxisbezug unsicher",
          tone: quality === "strong" ? "stable" : "watch",
        });
      }

      if (idx + 1 < CHECK.length) {
        setIdx((i) => i + 1);
        setPhase("pre");
        setSignal("Risiko neu bewertet");
        recalc("Risiko neu bewertet");
      } else {
        // Finale Zustandsbewertung — wird in die SystemConsciousness geschrieben
        const finalScore =
          next.reduce((a, q) => a + (q === "strong" ? 1 : q === "partial" ? 0.5 : 0), 0) / next.length;
        const finalReadiness = Math.round(40 + finalScore * 45); // 40..85
        setReadiness(Math.round(readiness * 0.4 + finalReadiness * 0.6));
        remember(
          finalScore >= 0.75
            ? "Erste Analyse: Prüfungsreife belastbar"
            : finalScore >= 0.45
            ? "Erste Analyse: Prüfungsreife beobachtet"
            : "Erste Analyse: Prüfungsreife noch nicht stabil",
          "Prüfungsreife-Analyse",
          toneFromScore(finalScore),
        );
        setPhase("result");
        recalc("Prüfungszustand aktualisiert");
      }
    }, 1400);
  }

  const subjectLabel = useMemo(() => {
    if (!slug) return "deine Prüfung";
    return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }, [slug]);

  return (
    <main className="relative min-h-screen bg-background text-foreground">
      <BackgroundAura tone={tone} />

      <div className="relative mx-auto w-full max-w-2xl px-4 pt-16 pb-24 sm:pt-20">
        {/* HEADER — diagnostisch, nicht "quiz" */}
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-card/70">
              <Cpu className="h-4 w-4 text-muted-foreground" aria-hidden />
            </span>
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Öffentliche Erstbewertung · ExamFit
              </div>
              <h1 className="text-base font-semibold leading-tight">Prüfungscheck</h1>
            </div>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1.5 text-[11px] text-muted-foreground backdrop-blur">
            <Radar className="h-3.5 w-3.5 animate-pulse" aria-hidden />
            <span className="font-medium">{signal ?? "System bereit"}</span>
          </div>
        </header>

        {/* ENTRY */}
        {phase === "entry" && (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="rounded-2xl border border-border/60 bg-card/60 p-5 backdrop-blur"
          >
            <SectionTitle icon={ShieldAlert} eyebrow="Erste Analyse" title={`Wie prüfungsreif bist du für ${subjectLabel} wirklich?`} />
            <p className="text-sm text-muted-foreground">
              In ungefähr 4 Minuten erhältst du die erste diagnostische Einschätzung deines
              Prüfungszustands. Die Analyse basiert auf typischen IHK-Bewertungssituationen.
              Das System bewertet nicht nur Antworten — sondern Risiken.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <RiskChip tone="critical" label="Transferargumentation typisch instabil" />
              <RiskChip tone="watch" label="Rückfragen-Risiko oft unterschätzt" />
              <RiskChip tone="stable" label="Praxisbezug zentrales Bewertungskriterium" />
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              {CHECK.map((q, i) => (
                <div
                  key={q.id}
                  className="rounded-xl border border-border/60 bg-background/40 p-3 text-xs text-muted-foreground"
                >
                  <div className="text-[10px] uppercase tracking-wider">Impuls {i + 1}</div>
                  <div className="mt-1 font-medium text-foreground">{q.domain}</div>
                </div>
              ))}
            </div>

            <button
              onClick={startCheck}
              className="mt-6 w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-95"
            >
              Erste Prüfungsanalyse starten
            </button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Nicht Lernstand. Prüfungsrealität.
            </p>
          </motion.section>
        )}

        {/* PRE-CONTEXT */}
        {phase === "pre" && (
          <motion.section
            key={`pre-${current.id}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="rounded-2xl border border-border/60 bg-card/60 p-5 backdrop-blur"
          >
            <div className="mb-3 flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" aria-hidden />
                {current.domain}
              </span>
              <span>Impuls {idx + 1} von {CHECK.length}</span>
            </div>
            <h2 className="text-sm font-semibold text-foreground">Diagnostischer Kontext</h2>
            <p className="mt-1 text-sm text-muted-foreground">{current.preContext}</p>
            <button
              onClick={toQuestion}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border/60 bg-background/40 px-4 py-3 text-sm font-medium text-foreground hover:bg-background/70"
            >
              Diagnostischen Impuls anzeigen
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </motion.section>
        )}

        {/* QUESTION */}
        {phase === "question" && (
          <motion.section
            key={`q-${current.id}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="rounded-2xl border border-border/60 bg-card/60 p-5 backdrop-blur"
          >
            <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">
              {current.domain}
            </div>
            <h2 className="text-base font-semibold leading-snug text-foreground">{current.prompt}</h2>
            <p className="mt-2 text-xs italic text-muted-foreground">{current.examinerLens}</p>

            <div className="mt-5 space-y-2">
              {current.options.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => pick(opt.quality)}
                  className="group w-full rounded-xl border border-border/60 bg-background/40 px-4 py-3 text-left text-sm text-foreground transition hover:border-primary/40 hover:bg-background/70"
                >
                  <span className="block">{opt.label}</span>
                </button>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Waves className="h-3.5 w-3.5" aria-hidden />
                Antwort wird in Prüfungsrealität bewertet
              </span>
              <span>{idx + 1} / {CHECK.length}</span>
            </div>
          </motion.section>
        )}

        {/* ANALYZING */}
        {phase === "analyzing" && (
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-2xl border border-border/60 bg-card/60 p-8 text-center backdrop-blur"
          >
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-background/50">
              <Brain className="h-4 w-4 animate-pulse text-muted-foreground" aria-hidden />
            </div>
            <p className="mt-4 text-sm font-medium text-foreground">Antwort wird analysiert…</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Stille Re-Evaluation · Prüfungszustand wird angepasst
            </p>
          </motion.section>
        )}

        {/* RESULT */}
        {phase === "result" && (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="rounded-2xl border border-border/60 bg-card/60 p-5 backdrop-blur"
          >
            <SectionTitle icon={Gauge} eyebrow="Erste Zustandsbewertung" title="Diagnostische Einschätzung" />
            <p className="text-sm text-muted-foreground">
              Dies ist deine erste diagnostische Einschätzung — keine Punktzahl, sondern eine
              Beobachtung deines aktuellen Prüfungszustands.
            </p>

            <div className="mt-4 space-y-2">
              {topRisks(3).map((r) => (
                <RiskChip key={r.key} tone={r.tone} label={`${r.label} · seit ${daysSince(r.since)}d`} />
              ))}
            </div>

            {/* Tutor-Interpretation */}
            <div className="mt-5 rounded-xl border border-border/60 bg-background/40 p-4">
              <SectionTitle icon={Sparkles} eyebrow="Tutor · Erst-Interpretation" title="Was das System sieht" />
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                <li>
                  · {tone === "critical"
                    ? "Die Begründung bleibt aktuell zu allgemein — ein Prüfer würde hier wahrscheinlich nachhaken."
                    : tone === "watch"
                    ? "Fachlich tragfähig, aber unter Belastung noch nicht stabil."
                    : "Antwortverhalten wirkt prüfungsnah belastbar."}
                </li>
                <li>· Transferfragen verursachen aktuell die meisten Risiken.</li>
                <li>· Stabilisierung beginnt mit Antwortstruktur, nicht mit Lernstoff.</li>
              </ul>
            </div>

            {/* Paywall-Identität — verkauft Fortsetzung der Beobachtung, nicht Kurs */}
            <div className="mt-5 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="text-[10px] uppercase tracking-[0.18em] text-primary/80">
                Fortsetzung der Beobachtung
              </div>
              <h3 className="mt-1 text-sm font-semibold text-foreground">
                Lass das System deinen Prüfungszustand weiter beobachten.
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Vertiefe die Analyse · Stabilisiere deine Prüfungsreife · Trainiere gezielt deine
                kritischsten Punktverluste.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Link
                  to="/app/start"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:opacity-95"
                >
                  Analyse vertiefen
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
                <Link
                  to="/app/tutor"
                  className="inline-flex w-full items-center justify-center rounded-xl border border-border/60 bg-background/40 px-4 py-3 text-sm font-medium text-foreground hover:bg-background/70"
                >
                  Tutor-Interpretation öffnen
                </Link>
              </div>
            </div>

            <p className="mt-4 text-center text-[11px] text-muted-foreground">
              {readiness}% · {readinessLabel(readiness)} · Dein Verlauf wird vom System erinnert.
            </p>
          </motion.section>
        )}
      </div>
    </main>
  );
}
