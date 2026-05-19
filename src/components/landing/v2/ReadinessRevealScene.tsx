import { motion, useInView } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Activity, AlertTriangle, ShieldCheck, Sparkles, Target } from "lucide-react";

/**
 * Readiness Reveal Scene — die "SO SIEHT DEINE PRÜFUNGSREIFE AUS" Szene.
 *
 * Stage-Reveal (scroll-triggered, läuft EINMAL):
 *  0. Idle / Analyse läuft
 *  1. Kompetenzen checken (Liste tickt durch)
 *  2. Heatmap baut sich auf
 *  3. Score zählt hoch (mit kurzer Spannung)
 *  4. Risiken + Lernpfad erscheinen
 *
 * Bewusst NICHT zu schnell — wirkt wie eine Bonitätsprüfung / Diagnose.
 */

const COMPETENCIES = [
  { name: "Kostenrechnung", v: 86, risk: "low" },
  { name: "Buchführung", v: 64, risk: "med" },
  { name: "Steuerrecht", v: 78, risk: "low" },
  { name: "Personal & Recht", v: 41, risk: "high" },
  { name: "Wirtschaftslehre", v: 28, risk: "crit" },
  { name: "Marketing", v: 72, risk: "low" },
  { name: "Logistik", v: 55, risk: "med" },
  { name: "Controlling", v: 81, risk: "low" },
] as const;

const RISK_BG: Record<string, string> = {
  low: "rgba(74,222,128,0.55)",
  med: "rgba(89,240,208,0.55)",
  high: "rgba(245,183,84,0.6)",
  crit: "rgba(239,77,107,0.65)",
};
const RISK_LABEL: Record<string, string> = {
  low: "stark",
  med: "stabil",
  high: "erhöhtes Prüfungsrisiko",
  crit: "kritische Kompetenzlücke",
};

/** Non-linear score reveal — Mikro-Asymmetrie: ungerade Pausen + kleine Korrekturen. */
function useStaggeredCount(run: boolean) {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (!run) return;
    // Bewusst unregelmäßig — kleine Korrekturen (49→48) wirken wie echte Berechnung, nicht wie Animation.
    const steps: Array<[number, number]> = [
      [0, 0],
      [320, 18],
      [580, 31],
      [870, 39],
      [1180, 49],
      [1430, 48], // Mikro-Korrektur — System "zieht nach"
      [1820, 48], // Denkpause
      [2240, 57],
      [2520, 62],
      [2790, 63],
      [3120, 63], // zweite Pause
      [3380, 66],
      [3540, 67],
    ];
    const timers = steps.map(([t, v]) => window.setTimeout(() => setN(v), t));
    return () => timers.forEach(clearTimeout);
  }, [run]);
  return n;
}

export function ReadinessRevealScene() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-25% 0px -25% 0px" });
  const [stage, setStage] = useState(0); // 0..5 (5 = rescue revealed)
  const [checked, setChecked] = useState(0);

  /* Choreo — 5 Phasen über ~7.0s
     Phase 1 (0–800ms)    schnelle Scans — technisch
     Phase 2 (800–2500)   Heatmap baut auf — diagnostisch (ungerade Abstände)
     Phase 3 (2500–5800)  Score zählt mit Mikro-Asymmetrie — Spannung
     Phase 4 (5800–6500)  Risiko-Flash (rot kurz) — Konsequenz / "Oh sh*t"
     Phase 5 (6500+)      Rettung: Lernpfad generiert — Erlösung
  */
  useEffect(() => {
    if (!inView) return;
    const timers: number[] = [];

    timers.push(window.setTimeout(() => setStage(1), 200));
    // Erste 4 Kompetenzen — leicht unregelmäßiges Tempo (nicht alle 110ms)
    [110, 230, 340, 480].forEach((t, i) => {
      timers.push(window.setTimeout(() => setChecked(i + 1), 250 + t));
    });

    // Phase 2 — diagnostisch, ungerade (kritische dauern länger)
    [820, 1130, 1480, 1770].forEach((t, i) => {
      timers.push(window.setTimeout(() => setChecked(i + 5), t));
    });
    timers.push(window.setTimeout(() => setStage(2), 1100));

    // Phase 3 — Score-Spannung
    timers.push(window.setTimeout(() => setStage(3), 2500));

    // Phase 4 — kurzer Risiko-Flash NACH Score-Landung
    timers.push(window.setTimeout(() => setStage(4), 6000));

    // Phase 5 — Rettung: Lernpfad bereit (psychologisch: nicht Angst, sondern Lösung)
    timers.push(window.setTimeout(() => setStage(5), 6700));

    return () => timers.forEach(clearTimeout);
  }, [inView]);

  const scoreRun = stage >= 3;
  const scoreVal = useStaggeredCount(scoreRun);

  return (
    <section className="relative py-20 sm:py-28 overflow-hidden" ref={ref}>
      {/* ambient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 40% at 50% 0%, rgba(46,211,183,0.10), transparent 70%), radial-gradient(50% 40% at 90% 80%, rgba(167,139,250,0.10), transparent 70%)",
        }}
        aria-hidden
      />

      <div className="relative container mx-auto max-w-6xl px-4">
        <div className="text-center max-w-2xl mx-auto mb-10 sm:mb-14">
          <span className="lp-chip">
            <Activity className="w-3.5 h-3.5" />
            Live-Analyse
          </span>
          <h2 className="lp-display mt-4 text-3xl sm:text-5xl font-bold leading-tight">
            So sieht deine <span className="lp-gradient-text">Prüfungsreife</span> aus.
          </h2>
          <p className="lp-body mt-4 text-base sm:text-lg text-[var(--lp-text-2)]">
            Keine Vermutung. Keine Selbsteinschätzung. Ein diagnostisches System, das in Echtzeit
            zeigt, wo du stehst — und was dich noch von der Prüfung trennt.
          </p>
        </div>

        {/* Scene */}
        <div className="lp-card p-4 sm:p-6 lg:p-8 relative overflow-hidden">
          {/* Status bar */}
          <div className="flex items-center justify-between mb-5 text-[11px] sm:text-xs">
            <div className="flex items-center gap-2 text-[var(--lp-text-2)]">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--lp-aqua)] opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--lp-aqua)]" />
              </span>
              <span className="tabular-nums">
                {stage === 0 && "Bereitstellen…"}
                {stage === 1 && `Prüfe Kompetenzen ${checked}/${COMPETENCIES.length}…`}
                {stage === 2 && "Erstelle Heatmap…"}
                {stage === 3 && "Berechne Bestehenswahrscheinlichkeit…"}
                {stage === 4 && (
                  <span className="text-[var(--lp-danger)]">
                    ⚠ Erhöhtes Prüfungsrisiko erkannt
                  </span>
                )}
                {stage >= 5 && "Lernpfad bereit · Analyse abgeschlossen"}
              </span>
            </div>
            <div className="hidden sm:flex items-center gap-1 text-[10px] uppercase tracking-wider text-[var(--lp-text-3)]">
              <span>Engine v3.4</span>
              <span className="mx-1">·</span>
              <span>Rahmenplan-Match</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr_1fr] gap-4 sm:gap-5">
            {/* LEFT — Competency checklist */}
            <div className="lp-glass rounded-2xl p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-3 text-[11px] uppercase tracking-wider text-[var(--lp-text-3)]">
                <Target className="w-3.5 h-3.5 text-[var(--lp-aqua)]" />
                Kompetenzen geprüft
              </div>
              <ul className="space-y-2">
                {COMPETENCIES.map((c, i) => {
                  const done = checked > i;
                  return (
                    <li
                      key={c.name}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <motion.span
                          className="inline-flex w-4 h-4 rounded-full items-center justify-center text-[10px] shrink-0"
                          style={{
                            background: done
                              ? "rgba(46,211,183,0.18)"
                              : "rgba(255,255,255,0.04)",
                            border: `1px solid ${
                              done ? "var(--lp-border-emerald)" : "var(--lp-border)"
                            }`,
                            color: done ? "var(--lp-aqua)" : "var(--lp-text-3)",
                          }}
                          animate={done ? { scale: [1, 1.15, 1] } : {}}
                          transition={{ duration: 0.4 }}
                        >
                          {done ? "✓" : ""}
                        </motion.span>
                        <span
                          className={`truncate ${
                            done ? "text-[var(--lp-text)]" : "text-[var(--lp-text-3)]"
                          }`}
                        >
                          {c.name}
                        </span>
                      </div>
                      {done && (
                        <motion.span
                          initial={{ opacity: 0, x: 4 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="text-[10px] tabular-nums text-[var(--lp-text-2)]"
                        >
                          {c.v}%
                        </motion.span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* CENTER — Score reveal */}
            <div className="lp-glass rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-center text-center relative overflow-hidden">
              <div className="text-[11px] uppercase tracking-wider text-[var(--lp-text-3)] mb-2">
                Prüfungsreife-Score
              </div>

              {/* Ring */}
              <div className="relative w-40 h-40 sm:w-48 sm:h-48 my-2">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                  <circle
                    cx="50"
                    cy="50"
                    r="44"
                    fill="none"
                    stroke="rgba(255,255,255,0.06)"
                    strokeWidth="6"
                  />
                  <motion.circle
                    cx="50"
                    cy="50"
                    r="44"
                    fill="none"
                    stroke="url(#scoreGrad)"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 44}
                    initial={{ strokeDashoffset: 2 * Math.PI * 44 }}
                    animate={{
                      strokeDashoffset: scoreRun
                        ? 2 * Math.PI * 44 * (1 - 0.67)
                        : 2 * Math.PI * 44,
                    }}
                    transition={{ duration: 2.2, ease: "easeOut" }}
                  />
                  <defs>
                    <linearGradient id="scoreGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#59F0D0" />
                      <stop offset="60%" stopColor="#2ED3B7" />
                      <stop offset="100%" stopColor="#f5b754" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="lp-display text-5xl sm:text-6xl font-bold tabular-nums text-[var(--lp-text)]">
                    {scoreVal !== null ? scoreVal : "—"}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--lp-text-3)] mt-1">
                    von 100
                  </div>
                </div>
              </div>

              {stage === 4 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="space-y-1.5"
                >
                  <div className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full bg-[rgba(239,77,107,0.12)] text-[var(--lp-danger)] border border-[rgba(239,77,107,0.35)] animate-pulse">
                    <AlertTriangle className="w-3 h-3" />
                    Erhöhtes Prüfungsrisiko
                  </div>
                  <div className="text-[11px] text-[var(--lp-text-3)]">
                    2 kritische Lücken erkannt
                  </div>
                </motion.div>
              )}
              {stage >= 5 && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                  className="space-y-1.5"
                >
                  <div className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full bg-[rgba(245,183,84,0.10)] text-[var(--lp-warn)] border border-[rgba(245,183,84,0.3)]">
                    <AlertTriangle className="w-3 h-3" />
                    Knappes Bestehen wahrscheinlich
                  </div>
                  <div className="text-[11px] text-[var(--lp-text-3)]">
                    Empfehlung: 21 Tage gezieltes Training → Ziel-Score 84
                  </div>
                </motion.div>
              )}
              {stage < 4 && (
                <div className="text-[11px] text-[var(--lp-text-3)] h-9 flex items-center">
                  {stage >= 3 ? "Wahrscheinlichkeit wird berechnet…" : "Wird berechnet…"}
                </div>
              )}
            </div>

            {/* RIGHT — Heatmap + Risk */}
            <div className="lp-glass rounded-2xl p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-3 text-[11px] uppercase tracking-wider text-[var(--lp-text-3)]">
                <Sparkles className="w-3.5 h-3.5 text-[var(--lp-aqua)]" />
                Kompetenz-Heatmap
              </div>
              <div className="grid grid-cols-4 gap-1.5 mb-4">
                {Array.from({ length: 16 }).map((_, i) => {
                  const v = [86, 64, 78, 41, 28, 72, 55, 81, 90, 38, 62, 70, 33, 88, 52, 24][i];
                  const c =
                    v > 75
                      ? RISK_BG.low
                      : v > 50
                      ? RISK_BG.med
                      : v > 35
                      ? RISK_BG.high
                      : RISK_BG.crit;
                  return (
                    <motion.div
                      key={i}
                      className="aspect-square rounded-md"
                      style={{ background: c }}
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={
                        stage >= 2
                          ? { opacity: 1, scale: 1 }
                          : { opacity: 0, scale: 0.5 }
                      }
                      transition={{ delay: 0.04 * i, duration: 0.35 }}
                    />
                  );
                })}
              </div>

              {stage >= 4 ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4 }}
                  className="space-y-2"
                >
                  <div className="text-[11px] uppercase tracking-wider text-[var(--lp-text-3)]">
                    Identifizierte Risiken
                  </div>
                  {[
                    {
                      l: "Wirtschaftslehre",
                      r: "crit" as const,
                      c: "Typische Ursache für Punktverlust — viele Prüflinge scheitern hier",
                    },
                    {
                      l: "Personal & Recht",
                      r: "high" as const,
                      c: "Erhöhtes Risiko im Fachgespräch",
                    },
                  ].map((r, i) => (
                    <motion.div
                      key={r.l}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{
                        opacity: 1,
                        x: 0,
                        borderColor:
                          stage === 4
                            ? "rgba(239,77,107,0.55)"
                            : "var(--lp-border)",
                        backgroundColor:
                          stage === 4
                            ? "rgba(239,77,107,0.08)"
                            : "rgba(255,255,255,0.03)",
                      }}
                      transition={{ delay: 0.15 + i * 0.18, duration: 0.4 }}
                      className="px-2.5 py-1.5 rounded-md border"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[var(--lp-text)]">{r.l}</span>
                        <span
                          className="text-[10px]"
                          style={{
                            color:
                              r.r === "crit"
                                ? "var(--lp-danger)"
                                : "var(--lp-warn)",
                          }}
                        >
                          {RISK_LABEL[r.r]}
                        </span>
                      </div>
                      <div className="text-[10px] text-[var(--lp-text-3)] mt-0.5 italic">
                        → {r.c}
                      </div>
                    </motion.div>
                  ))}
                  {stage >= 5 && (
                    <motion.div
                      initial={{ opacity: 0, y: 4, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                      className="flex items-center gap-1.5 mt-2 px-2.5 py-1.5 rounded-md bg-[rgba(46,211,183,0.10)] border border-[var(--lp-border-emerald)] text-[11px] text-[var(--lp-aqua)]"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Empfohlener Lernpfad bereit · 21 Tage
                    </motion.div>
                  )}
                </motion.div>
              ) : (
                <div className="text-[11px] text-[var(--lp-text-3)] h-20 flex items-center justify-center">
                  {stage >= 2 ? "Risiken werden klassifiziert…" : "Heatmap wird erstellt…"}
                </div>
              )}
            </div>
          </div>

          {/* Subtle bottom scanline while analyzing */}
          {stage < 4 && (
            <motion.div
              className="absolute left-0 right-0 h-px"
              style={{
                background:
                  "linear-gradient(90deg, transparent, rgba(89,240,208,0.7), transparent)",
              }}
              initial={{ top: 0 }}
              animate={{ top: ["0%", "100%"] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
              aria-hidden
            />
          )}
        </div>

        <p className="text-center text-xs text-[var(--lp-text-3)] mt-5">
          Real-Time-Simulation der Engine — basierend auf 1:1-IHK-Rahmenplan-Mapping.
        </p>
      </div>
    </section>
  );
}
