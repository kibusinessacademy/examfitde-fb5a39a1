import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles } from "lucide-react";

/**
 * OSReactionLine — die typing-in System-Antwort.
 *
 * Erscheint unmittelbar nach einer Nutzer-Aktion (Beruf-Auswahl, Antwort im
 * Pruefungscheck, Recalc) und macht spürbar, dass das System mitdenkt.
 *
 * Sprache: System-Ich-Form, kurz, niemals Status. "Verstanden", "Mir fällt auf",
 * "Ich richte aus".
 */

export interface OSReactionLineProps {
  /** Wechselt der Text → typing-in Reveal. Empty/null = unsichtbar. */
  text: string | null;
  /** Optionaler Schlüssel, um identische Texte erneut zu animieren. */
  cueKey?: string | number;
  /** Geschwindigkeit pro Zeichen in ms (default 18). */
  speed?: number;
  className?: string;
}

export default function OSReactionLine({
  text,
  cueKey,
  speed = 18,
  className,
}: OSReactionLineProps) {
  const [shown, setShown] = useState("");

  useEffect(() => {
    if (!text) {
      setShown("");
      return;
    }
    setShown("");
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setShown(text.slice(0, i));
      if (i >= text.length) window.clearInterval(id);
    }, speed);
    return () => window.clearInterval(id);
  }, [text, cueKey, speed]);

  return (
    <AnimatePresence mode="wait">
      {text && (
        <motion.div
          key={`${cueKey ?? text}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.32, ease: "easeOut" }}
          className={
            className ??
            "mt-3 inline-flex items-center gap-2 text-sm text-[var(--lp-text-2)]"
          }
          aria-live="polite"
        >
          <motion.span
            animate={{ rotate: [0, 12, 0], scale: [1, 1.15, 1] }}
            transition={{ duration: 1.4, ease: "easeOut" }}
            className="inline-flex"
            aria-hidden
          >
            <Sparkles className="h-3.5 w-3.5 text-[var(--lp-aqua,theme(colors.primary.DEFAULT))]" />
          </motion.span>
          <span className="leading-snug">
            {shown}
            <span
              className="ml-0.5 inline-block w-[6px] h-[1em] -mb-[2px] bg-current opacity-60 animate-pulse"
              aria-hidden
            />
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
