import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, ArrowRight, Sparkles, Brain, Mic, Target, BarChart3, PlayCircle, Search } from "lucide-react";
import { trackConversion } from "@/lib/seo-tracking";
import { writeOsBeruf } from "@/lib/os/os-identity";
import { OS_TONE, berufReactionLine } from "@/lib/os/os-copy";
import OSReactionLine from "@/components/os/OSReactionLine";


/**
 * Premium Hero v3 — "Prüfungsreife, nicht Technik".
 *
 *  - Eyebrow:  "Prüfungssimulation mit KI-Unterstützung"
 *  - Headline: "Finde heraus, wie prüfungsreif du wirklich bist."
 *  - Sub:      Schwäche/Sicherheit/Ergebnis statt Rahmenplan/IHK-Logik
 *  - Selector: Beruf/Prüfung-Auswahl direkt im Hero (Suchfeld + Chips)
 *  - CTA:      "Kostenlosen Prüfungscheck starten" — dynamisches Routing
 *
 * Kein "IHK", kein "Strict-RAG", kein "Rahmenplan" mehr im sichtbaren Hero —
 * USP wird emotional/funktional kommuniziert, nicht technisch.
 */

type BerufOption = {
  label: string;
  slug: string; // route segment for /pruefungscheck/:slug and /berufe/:slug
  aliases?: string[];
};

const BERUFE: BerufOption[] = [
  { label: "Industriekaufmann/-frau", slug: "industriekaufmann", aliases: ["industrie", "ik"] },
  { label: "Fachinformatiker/-in AE", slug: "fachinformatiker-ae", aliases: ["fisi", "fiae", "fachinformatik"] },
  { label: "AEVO / Ausbilderschein", slug: "aevo", aliases: ["ausbilder", "ada"] },
  { label: "Bilanzbuchhalter/-in", slug: "bilanzbuchhalter", aliases: ["bilanz", "buchhalter"] },
  { label: "Wirtschaftsfachwirt/-in", slug: "wirtschaftsfachwirt", aliases: ["fachwirt"] },
  { label: "Industriemeister/-in", slug: "industriemeister", aliases: ["meister"] },
];

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
    title: "KI-Tutor · mit Quellen",
    body: (
      <div className="space-y-2.5">
        <div className="text-xs text-[var(--lp-text-2)] leading-relaxed">
          „Warum ist die degressive Abschreibung 2024 wieder erlaubt?"
        </div>
        <div className="rounded-lg border border-[var(--lp-border)] bg-black/20 p-3 text-xs leading-relaxed text-[var(--lp-text)]">
          <span className="text-[var(--lp-aqua)]">▍</span> Das Wachstumschancengesetz reaktiviert
          §7 Abs. 2 EStG für bewegliche Wirtschaftsgüter…
          <div className="mt-2 flex flex-wrap gap-1.5">
            {["§7 EStG", "Lernfeld 4", "Kurs L4-K2"].map((s) => (
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
            <div className="text-xs text-[var(--lp-text-2)]">Fachgespräch · Antwort wird bewertet…</div>
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
  const navigate = useNavigate();
  const [idx, setIdx] = useState(0);
  const [ping, setPing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<BerufOption | null>(null);

  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % PANELS.length), 4200);
    return () => clearInterval(t);
  }, []);

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

  // Filter chips by search query (label + aliases)
  const filteredBerufe = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BERUFE;
    return BERUFE.filter(
      (b) =>
        b.label.toLowerCase().includes(q) ||
        b.slug.toLowerCase().includes(q) ||
        (b.aliases ?? []).some((a) => a.includes(q))
    );
  }, [query]);

  const targetHref = selected ? `/pruefungscheck/${selected.slug}` : "/pruefungscheck";

  const handleStart = () => {
    trackConversion({
      event: "cta_click",
      source: "hero_v3",
      label: selected ? `pruefungscheck_start:${selected.slug}` : "pruefungscheck_start",
    });
    navigate(targetHref);
  };



  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Enter on search → if exactly one match, select & route; else route to /berufe with query
    if (filteredBerufe.length === 1) {
      const b = filteredBerufe[0];
      setSelected(b);
      const short = b.label.split("/")[0].trim();
      writeOsBeruf({ slug: b.slug, label: b.label, short });
      trackConversion({
        event: "cta_click",
        source: "hero_v3",
        label: `pruefungscheck_search_enter:${b.slug}`,
      });
      navigate(`/pruefungscheck/${b.slug}`);
    } else if (query.trim()) {
      navigate(`/berufe?q=${encodeURIComponent(query.trim())}`);
    } else {
      navigate("/berufe");
    }
  };

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
            {OS_TONE.hero.eyebrow}
          </motion.span>

          <motion.h1
            className="lp-display mt-5 text-[34px] sm:text-5xl lg:text-[64px] font-bold leading-[1.04]"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
          >
            Sag mir deinen Beruf —{" "}
            <span className="lp-gradient-text">ich richte deine Prüfung aus.</span>
          </motion.h1>

          <motion.p
            className="lp-body mt-5 text-base sm:text-lg text-[var(--lp-text-2)] leading-relaxed max-w-xl"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
          >
            {OS_TONE.hero.sublineCore}
          </motion.p>

          {/* Beruf/Prüfung-Selector — direkt im Hero */}
          <motion.form
            onSubmit={handleSubmit}
            className="mt-7 lp-card p-4 sm:p-5"
            aria-label="Beruf oder Prüfung auswählen"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.22 }}
          >
            <label htmlFor="hero-beruf-search" className="block text-xs font-medium text-[var(--lp-text-2)] mb-2">
              Welchen Beruf bereitest du vor? Ich richte alles danach aus.
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--lp-text-3)]" aria-hidden />
              <input
                id="hero-beruf-search"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="z. B. Industriekaufmann, AEVO, Fachinformatiker…"
                className="w-full h-11 pl-10 pr-3 rounded-lg bg-white/[0.04] border border-[var(--lp-border-strong)] text-sm text-[var(--lp-text)] placeholder:text-[var(--lp-text-3)] focus:outline-none focus:border-[var(--lp-aqua)] transition"
                autoComplete="off"
              />
            </div>
            <ul className="mt-3 flex flex-wrap gap-2" role="listbox" aria-label="Berufe und Prüfungen">
              {filteredBerufe.length === 0 ? (
                <li className="text-xs text-[var(--lp-text-3)]">
                  Kein Treffer —{" "}
                  <Link to="/berufe" className="text-[var(--lp-aqua)] underline underline-offset-2">
                    alle Berufe ansehen
                  </Link>
                </li>
              ) : (
                filteredBerufe.map((b) => {
                  const isActive = selected?.slug === b.slug;
                  return (
                    <li key={b.slug}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onClick={() => {
                          const next = isActive ? null : b;
                          setSelected(next);
                          if (next) {
                            const short = next.label.split("/")[0].trim();
                            writeOsBeruf({ slug: next.slug, label: next.label, short });
                          } else {
                            writeOsBeruf(null);
                          }
                          trackConversion({
                            event: "cta_click",
                            source: "hero_v3",
                            label: `beruf_chip_select:${b.slug}`,
                          });
                        }}
                        className={`text-xs sm:text-sm px-3 py-1.5 rounded-full border transition ${
                          isActive
                            ? "bg-[rgba(46,211,183,0.18)] border-[var(--lp-aqua)] text-[var(--lp-aqua)]"
                            : "bg-white/[0.04] border-[var(--lp-border-strong)] text-[var(--lp-text-2)] hover:text-[var(--lp-text)] hover:border-[var(--lp-border-emerald)]"
                        }`}
                      >
                        {b.label}
                      </button>
                    </li>
                  );
                })
              )}
              <li>
                <Link
                  to="/berufe"
                  className="text-xs sm:text-sm px-3 py-1.5 rounded-full border border-dashed border-[var(--lp-border-strong)] text-[var(--lp-text-3)] hover:text-[var(--lp-text)] hover:border-[var(--lp-aqua)] transition inline-block"
                >
                  Alle anzeigen →
                </Link>
              </li>
            </ul>

            {/* System-Reaktion auf Beruf-Auswahl — typing-in */}
            <OSReactionLine
              text={selected ? berufReactionLine({ label: selected.label }) : null}
              cueKey={selected?.slug}
              className="mt-3 inline-flex items-center gap-2 text-sm text-[var(--lp-aqua)]"
            />
          </motion.form>


          <motion.div
            className="mt-5 flex flex-col sm:flex-row gap-3"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            <button
              type="button"
              onClick={handleStart}
              className="lp-cta-primary h-14 px-7 inline-flex items-center justify-center text-base group"
              data-cta-location="hero_v3_primary"
              aria-label={
                selected
                  ? `Kostenlosen Prüfungscheck für ${selected.label} starten`
                  : "Kostenlosen Prüfungscheck starten"
              }
            >
              <ClipboardCheck className="w-5 h-5 mr-2" />
              {selected
                ? OS_TONE.hero.primaryCtaWithBeruf(selected.label.split("/")[0].trim())
                : OS_TONE.hero.primaryCta}
              <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-0.5" />
            </button>
            <a href="#demos" className="contents">
              <button
                className="lp-cta-ghost h-14 px-6 inline-flex items-center justify-center text-base"
                data-cta-location="hero_v3_secondary"
                onClick={() =>
                  trackConversion({
                    event: "cta_click",
                    source: "hero_v3",
                    label: "live_demo_scroll",
                  })
                }
              >
                <PlayCircle className="w-5 h-5 mr-2" />
                Demo ansehen
              </button>
            </a>
          </motion.div>

          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--lp-text-3)]">
            <span>✓ 4 Minuten</span>
            <span>✓ Keine Anmeldung</span>
            <span>✓ Mit Quellen</span>
            <span>✓ Schriftlich + mündlich</span>
          </div>
        </div>

        {/* RIGHT — stacked floating panels with parallax + breathing */}
        <div className="relative h-[420px] sm:h-[460px] lg:h-[520px]">
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
