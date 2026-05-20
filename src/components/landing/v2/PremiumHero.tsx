import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { ClipboardCheck, ArrowRight, Sparkles, Brain, Mic, Target, BarChart3, PlayCircle } from "lucide-react";
import { trackConversion } from "@/lib/seo-tracking";

/**
 * Premium split-hero — C+A combination:
 *  - Headline = emotional Hook (4 Minuten Prüfungsreife)
 *  - Subline  = technologischer Moat (Strict-RAG + schriftl./mündl.)
 *
 * Right-side panels: micro-parallax + breathing + light hierarchy
 * (active panel glows strong, ghosts are dimmer than before).
 */
const PANELS = [
  {
    id: "score",
    icon: BarChart3,
    title: "Bestehenswahrscheinlichkeit",
    body: (
      <div className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--lp-text-3)]">
              Prüfungsreife-Score
            </div>
            <div className="text-4xl font-bold text-[var(--lp-text)] tabular-nums">
              72<span className="text-base text-[var(--lp-text-2)]">/100</span>
            </div>
          </div>
          <span className="text-[11px] px-2 py-1 rounded-md bg-[rgba(74,222,128,0.12)] text-[var(--lp-success)] border border-[rgba(74,222,128,0.25)]">
            Bestehen wahrscheinlich
          </span>
        </div>
        <div className="h-2 rounded-full bg-white/5 overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: "linear-gradient(90deg, #2ED3B7, #59F0D0)" }}
            initial={{ width: 0 }}
            animate={{ width: "72%" }}
            transition={{ duration: 1.1, ease: "easeOut" }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-[var(--lp-text-3)]">
          <span>2 kritische Lücken</span>
          <span className="text-[var(--lp-aqua)]">+8 Punkte / Woche</span>
        </div>
      </div>
    ),
  },
  {
    id: "comp",
    icon: Target,
    title: "Schwächenanalyse",
    body: (
      <div className="space-y-2.5">
        {[
          { l: "Kostenrechnung", v: 86, c: "var(--lp-success)" },
          { l: "Buchführung", v: 64, c: "var(--lp-aqua)" },
          { l: "Personal & Recht", v: 41, c: "var(--lp-warn)" },
          { l: "Wirtschaftslehre", v: 28, c: "var(--lp-danger)" },
        ].map((r, i) => (
          <div key={r.l}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-[var(--lp-text-2)]">{r.l}</span>
              <span className="text-[var(--lp-text)] tabular-nums">{r.v}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: r.c }}
                initial={{ width: 0 }}
                animate={{ width: `${r.v}%` }}
                transition={{ duration: 0.8, delay: 0.1 * i }}
              />
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "tutor",
    icon: Brain,
    title: "KI-Tutor · Strict-RAG",
    body: (
      <div className="space-y-2.5">
        <div className="text-xs text-[var(--lp-text-2)] leading-relaxed">
          „Warum ist die degressive Abschreibung 2024 wieder erlaubt?"
        </div>
        <div className="rounded-lg border border-[var(--lp-border)] bg-black/20 p-3 text-xs leading-relaxed text-[var(--lp-text)]">
          <span className="text-[var(--lp-aqua)]">▍</span> Das Wachstumschancengesetz reaktiviert
          §7 Abs. 2 EStG für bewegliche Wirtschaftsgüter…
          <div className="mt-2 flex flex-wrap gap-1.5">
            {["§7 EStG", "Rahmenplan §3.2", "Kurs L4-K2"].map((s) => (
              <span
                key={s}
                className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(46,211,183,0.1)] text-[var(--lp-aqua)] border border-[var(--lp-border-emerald)]"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "oral",
    icon: Mic,
    title: "Mündliche Simulation",
    body: (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="relative w-10 h-10 rounded-full bg-[rgba(46,211,183,0.15)] flex items-center justify-center">
            <Mic className="w-4 h-4 text-[var(--lp-aqua)]" />
            <span className="absolute inset-0 rounded-full border-2 border-[var(--lp-aqua)] animate-ping opacity-40" />
          </div>
          <div className="flex-1">
            <div className="text-xs text-[var(--lp-text-2)]">IHK-Fachgespräch · Antwort wird bewertet…</div>
            <div className="flex gap-0.5 mt-1.5">
              {Array.from({ length: 22 }).map((_, i) => (
                <motion.span
                  key={i}
                  className="w-0.5 rounded-full bg-[var(--lp-aqua)]"
                  animate={{ height: [4, 12 + (i % 5) * 3, 4] }}
                  transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.04 }}
                />
              ))}
            </div>
          </div>
          <div className="text-xs tabular-nums text-[var(--lp-text-2)]">02:14</div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { l: "Fach", v: 88 },
            { l: "Struktur", v: 72 },
            { l: "Praxis", v: 81 },
          ].map((s) => (
            <div key={s.l} className="rounded-md border border-[var(--lp-border)] py-1.5 bg-white/[0.02]">
              <div className="text-xs text-[var(--lp-text)] font-semibold tabular-nums">{s.v}</div>
              <div className="text-[10px] text-[var(--lp-text-3)]">{s.l}</div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
];

const LIVE_PINGS = [
  "+1 Punkt · Kostenrechnung",
  "Quelle aktualisiert · § 286 BGB",
  "Kompetenz auf 'mastered'",
  "Neue Empfehlung bereit",
  "Score refresht · +2",
];

export function PremiumHero() {
  const [idx, setIdx] = useState(0);
  const [ping, setPing] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % PANELS.length), 4200);
    return () => clearInterval(t);
  }, []);

  // Rare "live moment" — every ~13–17s, briefly show a tiny system update
  useEffect(() => {
    let timeout: number;
    const schedule = () => {
      const delay = 13000 + Math.random() * 4000;
      timeout = window.setTimeout(() => {
        const msg = LIVE_PINGS[Math.floor(Math.random() * LIVE_PINGS.length)];
        setPing(msg);
        window.setTimeout(() => setPing(null), 2400);
        schedule();
      }, delay);
    };
    schedule();
    return () => clearTimeout(timeout);
  }, []);

  const Active = PANELS[idx];

  return (
    <section className="relative overflow-hidden pt-12 sm:pt-16 lg:pt-24 pb-16 lg:pb-24">
      <div className="lp-hero-glow" aria-hidden />
      <div className="lp-grid-bg" aria-hidden />

      <div className="relative container mx-auto max-w-6xl px-4 grid lg:grid-cols-[1.05fr_1fr] gap-10 lg:gap-12 items-center">
        {/* LEFT */}
        <div>
          <motion.span
            className="lp-chip"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Die erste KI-Prüfungsplattform mit Strict-RAG
          </motion.span>

          <motion.h1
            className="lp-display mt-5 text-[34px] sm:text-5xl lg:text-[64px] font-bold leading-[1.04]"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
          >
            Finde in 4 Minuten heraus,{" "}
            <span className="lp-gradient-text">wie prüfungsreif du wirklich bist.</span>
          </motion.h1>

          <motion.p
            className="lp-body mt-5 text-base sm:text-lg text-[var(--lp-text-2)] leading-relaxed max-w-xl"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
          >
            Die einzige KI-Prüfungsplattform, die <strong className="text-[var(--lp-text)] font-semibold">nur aus deinem Rahmenplan und Kursinhalt</strong> antwortet — mit schriftlicher & mündlicher Prüfungssimulation nach IHK-Logik.
          </motion.p>

          {/* Proof pills */}
          <motion.ul
            className="mt-5 flex flex-wrap gap-2"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.22 }}
          >
            {[
              "Kein Abo",
              "Schriftlich + mündlich",
              "Antworten mit Quellen",
              "Keine Zufallsfragen",
            ].map((p) => (
              <li
                key={p}
                className="text-[11px] sm:text-xs px-2.5 py-1 rounded-full border border-[var(--lp-border-strong)] bg-white/[0.04] text-[var(--lp-text-2)]"
              >
                {p}
              </li>
            ))}
          </motion.ul>

          <motion.div
            className="mt-7 flex flex-col sm:flex-row gap-3"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            <Link to="/pruefungscheck" className="contents">
              <button
                className="lp-cta-primary h-14 px-7 inline-flex items-center justify-center text-base group"
                data-cta-location="hero_v2_primary"
                onClick={() =>
                  trackConversion({
                    event: "cta_click",
                    source: "hero_v2",
                    label: "pruefungsreife_test",
                  })
                }
              >
                <ClipboardCheck className="w-5 h-5 mr-2" />
                Kostenlos Prüfungsreife testen
                <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-0.5" />
              </button>
            </Link>
            <a href="#demos" className="contents">
              <button
                className="lp-cta-ghost h-14 px-6 inline-flex items-center justify-center text-base"
                data-cta-location="hero_v2_secondary"
                onClick={() =>
                  trackConversion({
                    event: "cta_click",
                    source: "hero_v2",
                    label: "live_demo_scroll",
                  })
                }
              >
                <PlayCircle className="w-5 h-5 mr-2" />
                Live-Demo ansehen
              </button>
            </a>
          </motion.div>

          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--lp-text-3)]">
            <span>✓ 4 Minuten</span>
            <span>✓ Keine Anmeldung</span>
            <span>✓ DSGVO-konform</span>
          </div>
        </div>

        {/* RIGHT — stacked floating panels with parallax + breathing */}
        <div className="relative h-[420px] sm:h-[460px] lg:h-[520px]">
          {/* Soft halo follows active panel */}
          <motion.div
            className="absolute inset-0 rounded-[28px]"
            style={{
              background:
                "radial-gradient(60% 60% at 50% 50%, rgba(89,240,208,0.22), transparent 70%)",
            }}
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            aria-hidden
          />

          {/* Backdrop ghost cards — micro-parallax with different periods + dimmer */}
          <motion.div
            className="absolute right-6 top-2 w-[78%] h-32 rounded-2xl lp-glass"
            animate={{ y: [0, -6, 0], x: [0, 2, 0] }}
            transition={{ duration: 6.5, repeat: Infinity, ease: "easeInOut" }}
            style={{ opacity: 0.32 }}
            aria-hidden
          />
          <motion.div
            className="absolute left-0 bottom-6 w-[60%] h-28 rounded-2xl lp-glass"
            animate={{ y: [0, 8, 0], x: [0, -3, 0] }}
            transition={{ duration: 7.8, repeat: Infinity, ease: "easeInOut", delay: 0.8 }}
            style={{ opacity: 0.28 }}
            aria-hidden
          />
          <motion.div
            className="absolute right-2 bottom-0 w-[40%] h-20 rounded-2xl lp-glass"
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 9, repeat: Infinity, ease: "easeInOut", delay: 1.6 }}
            style={{ opacity: 0.22 }}
            aria-hidden
          />

          {/* Active panel — breathes softly */}
          <AnimatePresence mode="wait">
            <motion.div
              key={Active.id}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92%] sm:w-[88%] lp-card p-5 sm:p-6"
              style={{
                boxShadow:
                  "0 30px 80px -30px rgba(0,0,0,0.75), 0 0 0 1px rgba(89,240,208,0.28) inset, 0 0 60px -10px rgba(89,240,208,0.25)",
              }}
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              animate={{
                opacity: 1,
                y: [0, -3, 0],
                scale: [1, 1.005, 1],
              }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
              transition={{
                opacity: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
                y: { duration: 4.2, repeat: Infinity, ease: "easeInOut" },
                scale: { duration: 4.2, repeat: Infinity, ease: "easeInOut" },
              }}
            >
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-lg bg-[rgba(46,211,183,0.18)] flex items-center justify-center border border-[var(--lp-border-emerald)]">
                  <Active.icon className="w-4 h-4 text-[var(--lp-aqua)]" />
                </div>
                <div className="text-sm font-medium text-[var(--lp-text)]">{Active.title}</div>
                <div className="ml-auto flex gap-1">
                  {PANELS.map((_, i) => (
                    <span
                      key={i}
                      className={`h-1 rounded-full transition-all ${
                        i === idx ? "w-5 bg-[var(--lp-aqua)]" : "w-1.5 bg-white/15"
                      }`}
                    />
                  ))}
                </div>
              </div>
              {Active.body}

              {/* Rare live update — wirkt wie ein echtes System, das gerade reagiert */}
              <AnimatePresence>
                {ping && (
                  <motion.div
                    key={ping}
                    initial={{ opacity: 0, y: 6, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.96 }}
                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute -top-2 right-4 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[rgba(46,211,183,0.14)] border border-[var(--lp-border-emerald)] backdrop-blur text-[10px] text-[var(--lp-aqua)] shadow-lg"
                  >
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--lp-aqua)] opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--lp-aqua)]" />
                    </span>
                    {ping}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
