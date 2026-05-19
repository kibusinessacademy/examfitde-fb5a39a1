import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import {
  Gauge,
  Radar,
  Sparkles,
  Brain,
  Mic,
  TrendingUp,
  Timer,
} from "lucide-react";

/** Hover-spotlight handler — sets CSS variables --mx / --my for .lp-tile::before */
function useSpotlight() {
  return (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
}

interface TileProps {
  className?: string;
  icon: typeof Gauge;
  label: string;
  title: string;
  children: ReactNode;
}

function Tile({ className = "", icon: Icon, label, title, children }: TileProps) {
  const spot = useSpotlight();
  return (
    <motion.div
      onMouseMove={spot}
      className={`lp-tile p-5 sm:p-6 flex flex-col ${className}`}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[var(--lp-text-3)] mb-2">
        <Icon className="w-3.5 h-3.5 text-[var(--lp-aqua)]" />
        {label}
      </div>
      <h3 className="lp-display text-lg sm:text-xl font-semibold text-[var(--lp-text)] mb-3 leading-snug">
        {title}
      </h3>
      <div className="flex-1 min-h-0">{children}</div>
    </motion.div>
  );
}

function CountUp({ to, suffix = "", duration = 1.4 }: { to: number; suffix?: string; duration?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / (duration * 1000));
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(to * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duration]);
  return (
    <span className="tabular-nums">
      {n}
      {suffix}
    </span>
  );
}

/* ───────────────────────── Interactive Heatmap ───────────────────────── */

const HEATMAP_CELLS = [
  { name: "Kostenrechnung", v: 86, err: "Deckungsbeitrag-Berechnung sicher", consequence: "Stabil im offenen Teil", risk: "low" },
  { name: "Buchführung", v: 64, err: "Konten-Zuordnung mit Abweichungen", consequence: "Wiederholung sichert 6–8 Punkte", risk: "med" },
  { name: "Steuerrecht", v: 78, err: "USt sicher, ESt teilweise unsicher", consequence: "Solide Basis für offene Aufgaben", risk: "low" },
  { name: "Personalwesen", v: 41, err: "Lohnabrechnung kritisch", consequence: "Typische Ursache für Punktverlust im offenen Teil", risk: "high" },
  { name: "Wirtschaftslehre", v: 28, err: "Marktformen häufig falsch zugeordnet", consequence: "Hohe Fehlerwahrscheinlichkeit — viele Prüflinge scheitern hier", risk: "crit" },
  { name: "Marketing", v: 72, err: "Marketing-Mix solide", consequence: "Prüfungsreif — keine Maßnahme nötig", risk: "low" },
  { name: "Logistik", v: 55, err: "Lagerkennzahlen unsicher", consequence: "Relevant für Berechnungsaufgaben", risk: "med" },
  { name: "Controlling", v: 81, err: "Kennzahlen stark", consequence: "Prüfungsreif", risk: "low" },
  { name: "Recht (Vertrag)", v: 90, err: "Vertragsrecht prüfungsreif", consequence: "Sicherer Punktbringer", risk: "low" },
  { name: "Recht (Arbeits)", v: 38, err: "Kündigungsfristen unsicher", consequence: "Relevant für Fachgespräch — hohes Risiko", risk: "high" },
  { name: "Finanzierung", v: 62, err: "Kreditarten ok", consequence: "Stabil — Wiederholung empfohlen", risk: "med" },
  { name: "Investition", v: 70, err: "Statisch ok, dynamisch wackelt", consequence: "Punktverlust möglich bei Kapitalwertmethode", risk: "med" },
  { name: "Beschaffung", v: 33, err: "ABC-Analyse mit häufigen Fehlern", consequence: "Typische Ursache für Punktverlust bei Bewertungsaufgaben", risk: "high" },
  { name: "Produktion", v: 88, err: "Fertigungsverfahren sicher", consequence: "Prüfungsreif", risk: "low" },
  { name: "Qualität", v: 52, err: "QM-Normen lückenhaft", consequence: "Wiederholung sichert Teilpunkte", risk: "med" },
  { name: "Datenschutz", v: 24, err: "DSGVO §§ kaum verfügbar", consequence: "Kritische Lücke — Fachgespräch-Risiko", risk: "crit" },
] as const;

const RISK_LABEL: Record<string, string> = {
  low: "starke Kompetenz",
  med: "stabil — Wiederholung empfohlen",
  high: "erhöhtes Prüfungsrisiko",
  crit: "kritische Kompetenzlücke",
};
const RISK_COLOR: Record<string, string> = {
  low: "var(--lp-success)",
  med: "var(--lp-aqua)",
  high: "var(--lp-warn)",
  crit: "var(--lp-danger)",
};
function cellBg(v: number) {
  return v > 75
    ? "rgba(74,222,128,0.65)"
    : v > 50
    ? "rgba(89,240,208,0.55)"
    : v > 35
    ? "rgba(245,183,84,0.6)"
    : "rgba(239,77,107,0.6)";
}

function InteractiveHeatmap() {
  const [active, setActive] = useState<number | null>(null);
  const c = active !== null ? HEATMAP_CELLS[active] : null;
  return (
    <div>
      <div className="grid grid-cols-4 gap-1.5">
        {HEATMAP_CELLS.map((cell, i) => (
          <motion.button
            key={cell.name}
            type="button"
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            onClick={() => setActive(active === i ? null : i)}
            className="aspect-square rounded-md focus:outline-none"
            style={{
              background: cellBg(cell.v),
              boxShadow:
                active === i
                  ? "0 0 0 2px rgba(89,240,208,0.8), 0 0 18px rgba(89,240,208,0.5)"
                  : "none",
            }}
            initial={{ opacity: 0, scale: 0.6 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.02 }}
            aria-label={`${cell.name} — ${cell.v}%`}
          />
        ))}
      </div>
      <div className="mt-3 min-h-[58px]">
        <AnimatePresence mode="wait">
          {c ? (
            <motion.div
              key={c.name}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="rounded-md bg-white/[0.03] border border-[var(--lp-border)] px-2.5 py-2"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-[var(--lp-text)] font-medium">{c.name}</span>
                <span className="text-[10px] tabular-nums text-[var(--lp-text-2)]">
                  {c.v}%
                </span>
              </div>
              <div
                className="text-[10px]"
                style={{ color: RISK_COLOR[c.risk] }}
              >
                {RISK_LABEL[c.risk]}
              </div>
              <div className="text-[10px] text-[var(--lp-text-3)] mt-0.5">
                {c.err}
              </div>
              {(c.risk === "high" || c.risk === "crit") && (
                <div className="text-[10px] text-[var(--lp-text-2)] mt-1 pt-1 border-t border-[var(--lp-border)] italic">
                  → {c.consequence}
                </div>
              )}
            </motion.div>
          ) : (
            <div className="text-[11px] text-[var(--lp-text-3)]">
              16 Kompetenzen · hover für Diagnose
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ───────────────────────── Streaming Tutor ───────────────────────── */

const TUTOR_TEXT =
  "Die Skontofrist beginnt mit dem Rechnungsdatum, nicht dem Lieferdatum. Maßgeblich ist § 286 BGB i.V.m. den Zahlungsbedingungen — relevant für Lernfeld 5 deiner Prüfung.";

function StreamingTutor() {
  const [shown, setShown] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setShown(0);
    setDone(false);
    const id = window.setInterval(() => {
      setShown((n) => {
        if (n >= TUTOR_TEXT.length) {
          clearInterval(id);
          setDone(true);
          return n;
        }
        return n + 1;
      });
    }, 22);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <div className="rounded-lg border border-[var(--lp-border)] bg-black/20 p-3 text-sm leading-relaxed text-[var(--lp-text)] min-h-[110px]">
        <div className="text-[10px] uppercase tracking-wider text-[var(--lp-text-3)] mb-1.5">
          Frage: Skonto — wann beginnt die Frist?
        </div>
        {TUTOR_TEXT.slice(0, shown)}
        <span
          className="inline-block w-[2px] h-[1em] align-text-bottom ml-0.5 bg-[var(--lp-aqua)]"
          style={{ animation: "lp-blink 1s steps(2) infinite" }}
        />
        <AnimatePresence>
          {done && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-2 flex flex-wrap gap-1.5"
            >
              <div className="text-[10px] uppercase tracking-wider text-[var(--lp-text-3)] w-full mb-0.5">
                Quellen
              </div>
              {["§ 286 BGB", "Rahmenplan §4.1", "Kurs L5-K1", "Trainer Q-1142"].map((s) => (
                <span
                  key={s}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(46,211,183,0.1)] text-[var(--lp-aqua)] border border-[var(--lp-border-emerald)]"
                >
                  {s}
                </span>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="mt-2 text-[11px] text-[var(--lp-text-3)]">
        Antwortet nur aus Kurs + Rahmenplan. Niemals frei erfunden.
      </div>
    </>
  );
}

/* ───────────────────────── Oral Sim with Drama ───────────────────────── */

/** Mikro-Varianz pro Session — fühlt sich weniger scripted an.
 *  Werte bleiben innerhalb plausibler Bewertungsbänder. */
const ORAL_SCORE_VARIANTS: ReadonlyArray<ReadonlyArray<{ l: string; v: number }>> = [
  [{ l: "Fach", v: 88 }, { l: "Struktur", v: 72 }, { l: "Praxis", v: 81 }],
  [{ l: "Fach", v: 84 }, { l: "Struktur", v: 76 }, { l: "Praxis", v: 79 }],
  [{ l: "Fach", v: 91 }, { l: "Struktur", v: 69 }, { l: "Praxis", v: 83 }],
  [{ l: "Fach", v: 86 }, { l: "Struktur", v: 74 }, { l: "Praxis", v: 77 }],
];
const ORAL_SCORES = ORAL_SCORE_VARIANTS[Math.floor(Math.random() * ORAL_SCORE_VARIANTS.length)];

/**
 * Choreo (zyklisch, ~16s):
 *  0–8.5s  SPEAKING  — Waveform aktiv, Timer läuft, Status-Carousel
 *  8.5–9.5 SETTLE    — Waveform fällt, Timer stoppt, "Prüfer analysiert Antwort…"
 *  9.5–13  REVEAL    — Scores erscheinen nacheinander (Fach → Struktur → Praxis)
 *  13–16   VERDICT   — Gesamt-Badge sichtbar
 *  loop
 */
function OralSimulation() {
  const [phase, setPhase] = useState<"speaking" | "settle" | "reveal" | "verdict">(
    "speaking",
  );
  const [secs, setSecs] = useState(124);
  const [revealed, setRevealed] = useState(0); // 0..3

  // Phase driver
  useEffect(() => {
    const timers: number[] = [];
    const cycle = () => {
      setPhase("speaking");
      setRevealed(0);
      setSecs(124);
      timers.push(window.setTimeout(() => setPhase("settle"), 8500));
      timers.push(window.setTimeout(() => setPhase("reveal"), 9500));
      // Uneven micro-pauses zwischen Scores — wirkt deliberativ, nicht synchron animiert
      timers.push(window.setTimeout(() => setRevealed(1), 9750));   // Fach (schnell)
      timers.push(window.setTimeout(() => setRevealed(2), 10950));  // Struktur (Pause)
      timers.push(window.setTimeout(() => setRevealed(3), 12450));  // Praxis (längere Pause)
      timers.push(window.setTimeout(() => setPhase("verdict"), 13400));
      timers.push(window.setTimeout(cycle, 16400));
    };
    cycle();
    return () => timers.forEach(clearTimeout);
  }, []);

  // Timer ticks only while speaking
  useEffect(() => {
    if (phase !== "speaking") return;
    const t = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  const speaking = phase === "speaking";

  const statusText =
    phase === "speaking"
      ? "IHK-Fachgespräch · Antwort wird transkribiert…"
      : phase === "settle"
      ? "Prüfer analysiert Antwort…"
      : phase === "reveal"
      ? "Bewertung wird aufgebaut…"
      : "Bewertung abgeschlossen";

  return (
    <>
      <div className="flex items-center gap-3">
        <div className="flex gap-0.5 flex-1">
          {Array.from({ length: 40 }).map((_, i) => (
            <motion.span
              key={i}
              className="w-0.5 rounded-full bg-[var(--lp-aqua)]"
              animate={
                speaking
                  ? { height: [4, 6 + (i % 7) * 4, 4], opacity: 1 }
                  : { height: 4, opacity: 0.35 }
              }
              transition={
                speaking
                  ? { duration: 0.9, repeat: Infinity, delay: i * 0.03 }
                  : { duration: 0.5 }
              }
            />
          ))}
        </div>
        <Timer className="w-4 h-4 text-[var(--lp-text-2)]" />
        <span
          className={`text-xs tabular-nums transition-colors ${
            speaking ? "text-[var(--lp-text-2)]" : "text-[var(--lp-text-3)]"
          }`}
        >
          {mm}:{ss}
        </span>
      </div>

      <div className="mt-2 h-4 overflow-hidden text-[11px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={statusText}
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -10, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className={
              phase === "settle"
                ? "text-[var(--lp-aqua)]"
                : "text-[var(--lp-text-3)]"
            }
          >
            {statusText}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3">
        {ORAL_SCORES.map((s, i) => {
          const shown = revealed > i;
          return (
            <motion.div
              key={s.l}
              className="rounded-lg border border-[var(--lp-border)] bg-white/[0.02] p-2.5 text-center"
              animate={{
                borderColor: shown ? "var(--lp-border-emerald)" : "var(--lp-border)",
              }}
              transition={{ duration: 0.4 }}
            >
              <div className="lp-display text-2xl font-bold tabular-nums text-[var(--lp-text)] h-8 flex items-center justify-center">
                <AnimatePresence mode="wait">
                  {shown ? (
                    <motion.span
                      key="v"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25 }}
                    >
                      {s.v}
                    </motion.span>
                  ) : (
                    <motion.span
                      key="dot"
                      className="text-[var(--lp-text-3)] text-base"
                      animate={{ opacity: [0.3, 0.7, 0.3] }}
                      transition={{ duration: 1.2, repeat: Infinity }}
                    >
                      ···
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
              <div className="text-[10px] text-[var(--lp-text-3)] uppercase tracking-wider">
                {s.l}
              </div>
            </motion.div>
          );
        })}
      </div>
    </>
  );
}

/* ───────────────────────── Grid ───────────────────────── */

export function BentoDemoGrid() {
  return (
    <section id="demos" className="relative py-20 sm:py-28 scroll-mt-16">
      <div className="container mx-auto max-w-6xl px-4">
        <div className="text-center mb-12 sm:mb-16 max-w-2xl mx-auto">
          <span className="lp-chip">Erlebe das System</span>
          <h2 className="lp-display mt-4 text-3xl sm:text-5xl font-bold leading-tight">
            Sieben Module, die wie{" "}
            <span className="lp-gradient-text">ein Gehirn arbeiten.</span>
          </h2>
          <p className="lp-body mt-4 text-[var(--lp-text-2)]">
            Kein Stückwerk. Jedes Modul kennt deinen Fortschritt — und reagiert darauf.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 auto-rows-[minmax(220px,auto)] gap-4">
          {/* Tile 1 — Readiness Score (HERO TILE) */}
          <Tile
            className="sm:col-span-2 lg:col-span-2 lg:row-span-2"
            icon={Gauge}
            label="Tile 01 · Bestehenswahrscheinlichkeit"
            title="Dein Prüfungs-Score — wie ein Credit-Score."
          >
            <div className="flex items-end gap-5 mt-2">
              <div className="text-6xl sm:text-7xl font-bold lp-gradient-text leading-none">
                <CountUp to={72} />
              </div>
              <div className="pb-2">
                <div className="text-xs text-[var(--lp-text-2)]">von 100</div>
                <div className="text-xs text-[var(--lp-success)] mt-0.5">▲ 8 Punkte / Woche</div>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-7 gap-1.5">
              {[35, 42, 48, 55, 58, 66, 72].map((v, i) => (
                <motion.div
                  key={i}
                  className="rounded-md"
                  style={{
                    height: `${v}px`,
                    background:
                      "linear-gradient(180deg, rgba(89,240,208,0.7), rgba(46,211,183,0.2))",
                  }}
                  initial={{ scaleY: 0, transformOrigin: "bottom" }}
                  whileInView={{ scaleY: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, delay: 0.05 * i }}
                />
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-[var(--lp-text-3)]">
              {["W1", "W2", "W3", "W4", "W5", "W6", "W7"].map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
          </Tile>

          {/* Tile 2 — Interactive Heatmap */}
          <Tile
            icon={Radar}
            label="Tile 02 · Diagnose"
            title="Kompetenz-Heatmap — interaktiv."
          >
            <InteractiveHeatmap />
          </Tile>

          {/* Tile 3 — Keine Zufallsfragen */}
          <Tile icon={Sparkles} label="Tile 03 · Targeting" title="Keine Zufallsfragen.">
            <div className="space-y-2">
              {[
                { q: "USt §13b UStG", tag: "schwächste Kompetenz", ok: false },
                { q: "Skonto-Berechnung", tag: "Wiederholung in 3 Tagen", ok: true },
                { q: "AfA degressiv 2024", tag: "neu im Rahmenplan", ok: true },
              ].map((r) => (
                <div
                  key={r.q}
                  className="rounded-md border border-[var(--lp-border)] px-3 py-2 bg-white/[0.02]"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--lp-text)]">{r.q}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        r.ok
                          ? "bg-[rgba(46,211,183,0.10)] text-[var(--lp-aqua)]"
                          : "bg-[rgba(239,77,107,0.12)] text-[var(--lp-danger)]"
                      }`}
                    >
                      {r.ok ? "geplant" : "jetzt"}
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--lp-text-3)] mt-0.5">{r.tag}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-[11px] text-[var(--lp-text-3)]">
              Jede Aufgabe trainiert gezielt deine schwächste Kompetenz.
            </div>
          </Tile>

          {/* Tile 4 — KI-Tutor streaming */}
          <Tile
            className="sm:col-span-2 lg:col-span-2"
            icon={Brain}
            label="Tile 04 · KI-Tutor"
            title="Strict-RAG. Mit Quellen. Ohne Halluzination."
          >
            <StreamingTutor />
          </Tile>

          {/* Tile 5 — Oral Sim with drama */}
          <Tile
            className="sm:col-span-2 lg:col-span-2"
            icon={Mic}
            label="Tile 05 · Mündlich"
            title="Wie ein echter Prüfer."
          >
            <OralSimulation />
          </Tile>

          {/* Tile 6 — Streak */}
          <Tile icon={TrendingUp} label="Tile 06 · Lernfortschritt" title="Tägliche Streak.">
            <div className="grid grid-cols-7 gap-1.5">
              {[1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1].map((d, i) => (
                <div
                  key={i}
                  className="aspect-square rounded"
                  style={{
                    background:
                      d === 1 ? "rgba(89,240,208,0.55)" : "rgba(255,255,255,0.05)",
                  }}
                />
              ))}
            </div>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="lp-display text-3xl font-bold text-[var(--lp-text)] tabular-nums">
                12
              </span>
              <span className="text-xs text-[var(--lp-text-2)]">Tage Streak</span>
            </div>
          </Tile>

          {/* Tile 7 — Simulation */}
          <Tile icon={Sparkles} label="Tile 07 · Simulation" title="Volle Prüfung. Echte Zeit.">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-[var(--lp-text-2)]">Frage 38 / 60</span>
              <span className="text-xs tabular-nums text-[var(--lp-aqua)]">42:18</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <motion.div
                className="h-full"
                style={{ background: "linear-gradient(90deg, #2ED3B7, #59F0D0)" }}
                initial={{ width: 0 }}
                whileInView={{ width: "63%" }}
                viewport={{ once: true }}
                transition={{ duration: 1 }}
              />
            </div>
            <div className="mt-3 text-xs text-[var(--lp-text-2)]">
              Punkte: <span className="text-[var(--lp-text)] font-medium">68 / 100</span>
            </div>
          </Tile>
        </div>
      </div>
    </section>
  );
}
