import { motion } from "framer-motion";
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
          {/* Tile 1 — Readiness Score (HERO TILE — dominant) */}
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

          {/* Tile 2 — Competencies */}
          <Tile icon={Radar} label="Tile 02 · Schwächen" title="Kompetenz-Heatmap.">
            <div className="grid grid-cols-4 gap-1.5">
              {Array.from({ length: 16 }).map((_, i) => {
                const v = [85, 60, 30, 70, 45, 90, 25, 55, 75, 40, 65, 80, 35, 50, 95, 20][i];
                const c =
                  v > 75
                    ? "rgba(74,222,128,0.7)"
                    : v > 50
                    ? "rgba(89,240,208,0.6)"
                    : v > 30
                    ? "rgba(245,183,84,0.6)"
                    : "rgba(239,77,107,0.55)";
                return (
                  <motion.div
                    key={i}
                    className="aspect-square rounded-md"
                    style={{ background: c }}
                    initial={{ opacity: 0, scale: 0.6 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.03 }}
                  />
                );
              })}
            </div>
            <div className="mt-3 text-xs text-[var(--lp-text-2)]">
              16 Kompetenzen · 4 Schwerpunkte identifiziert
            </div>
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

          {/* Tile 4 — KI-Tutor (wide) */}
          <Tile
            className="sm:col-span-2 lg:col-span-2"
            icon={Brain}
            label="Tile 04 · KI-Tutor"
            title="Strict-RAG. Mit Quellen. Ohne Halluzination."
          >
            <div className="rounded-lg border border-[var(--lp-border)] bg-black/20 p-3 text-sm leading-relaxed text-[var(--lp-text)]">
              <span className="text-[var(--lp-aqua)] mr-1">▍</span>
              Die Skontofrist beginnt mit dem Rechnungsdatum, nicht dem Lieferdatum…
              <div className="mt-2 flex flex-wrap gap-1.5">
                {["§ 286 BGB", "Rahmenplan §4.1", "Kurs L3-K1", "Trainer Q-1142"].map((s) => (
                  <span
                    key={s}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(46,211,183,0.1)] text-[var(--lp-aqua)] border border-[var(--lp-border-emerald)]"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-2 text-[11px] text-[var(--lp-text-3)]">
              Antwortet nur aus Kurs + Rahmenplan. Niemals frei erfunden.
            </div>
          </Tile>

          {/* Tile 5 — Oral Sim (wide) */}
          <Tile
            className="sm:col-span-2 lg:col-span-2"
            icon={Mic}
            label="Tile 05 · Mündlich"
            title="Wie ein echter Prüfer."
          >
            <div className="flex items-center gap-3">
              <div className="flex gap-0.5 flex-1">
                {Array.from({ length: 40 }).map((_, i) => (
                  <motion.span
                    key={i}
                    className="w-0.5 rounded-full bg-[var(--lp-aqua)]"
                    animate={{ height: [4, 6 + (i % 7) * 4, 4] }}
                    transition={{
                      duration: 0.9,
                      repeat: Infinity,
                      delay: i * 0.03,
                    }}
                  />
                ))}
              </div>
              <Timer className="w-4 h-4 text-[var(--lp-text-2)]" />
              <span className="text-xs tabular-nums text-[var(--lp-text-2)]">03:42</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4">
              {[
                { l: "Fach", v: 88 },
                { l: "Struktur", v: 72 },
                { l: "Praxis", v: 81 },
              ].map((s) => (
                <div key={s.l} className="rounded-lg border border-[var(--lp-border)] bg-white/[0.02] p-2.5 text-center">
                  <div className="lp-display text-2xl font-bold text-[var(--lp-text)] tabular-nums">
                    {s.v}
                  </div>
                  <div className="text-[10px] text-[var(--lp-text-3)] uppercase tracking-wider">
                    {s.l}
                  </div>
                </div>
              ))}
            </div>
          </Tile>

          {/* Tile 6 — Progress */}
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

          {/* Tile 7 — Exam Simulation */}
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
