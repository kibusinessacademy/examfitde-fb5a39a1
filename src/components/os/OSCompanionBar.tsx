import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useSystemConsciousness } from "@/lib/system/SystemConsciousness";
import { companionMessageFor, isOsSurface } from "@/lib/os/os-copy";
import { useOsBeruf } from "@/lib/os/os-identity";

/**
 * OS Companion Bar — der ruhige, antizipierende Strip an der Oberkante.
 *
 * Eine einzige Zeile, die zeigt, dass das System mitdenkt. Surface-aware
 * (Landing, Pruefungscheck, /app). Liest aus SystemConsciousness + OS-Identity.
 *
 * Verhalten:
 *  - eine Zeile, leise, niemals Notification
 *  - typing-in Reveal beim Wechsel der Aussage
 *  - Sparkle-Pulse bei Recalc-Events
 *  - Beruf-Echo: ein einmaliger weicher Highlight nach Beruf-Wechsel
 */

export default function OSCompanionBar() {
  const { pathname } = useLocation();
  const { readiness, lastRecalc, topRisks } = useSystemConsciousness();
  const beruf = useOsBeruf();

  const top = topRisks(1)[0];
  const urgent = top?.tone === "critical";

  const message = useMemo(
    () => companionMessageFor(pathname, { beruf: beruf?.short ?? beruf?.label ?? null, readiness, urgent }),
    [pathname, beruf, readiness, urgent],
  );

  const [pulse, setPulse] = useState(false);
  const [echo, setEcho] = useState(false);

  // Sparkle-pulse on recalc
  useEffect(() => {
    if (!lastRecalc) return;
    setPulse(true);
    const t = window.setTimeout(() => setPulse(false), 1400);
    return () => window.clearTimeout(t);
  }, [lastRecalc]);

  // One-time echo when Beruf changes
  useEffect(() => {
    if (!beruf) return;
    setEcho(true);
    const t = window.setTimeout(() => setEcho(false), 1800);
    return () => window.clearTimeout(t);
  }, [beruf?.slug]);

  if (!isOsSurface(pathname)) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center px-3 pt-[max(0.5rem,env(safe-area-inset-top))]"
      aria-live="polite"
    >
      <motion.div
        initial={false}
        animate={
          echo
            ? { boxShadow: "0 0 0 4px hsl(var(--primary) / 0.18)" }
            : { boxShadow: "0 0 0 0 hsl(var(--primary) / 0)" }
        }
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="pointer-events-auto flex max-w-2xl flex-1 items-center gap-2 rounded-full border border-border/50 bg-card/75 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur-md"
      >
        <motion.span
          animate={pulse ? { scale: [1, 1.18, 1], rotate: [0, 8, 0] } : { scale: 1, rotate: 0 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
          className="inline-flex shrink-0"
          aria-hidden
        >
          <Sparkles className={`h-3.5 w-3.5 ${pulse ? "text-primary" : "opacity-70"}`} />
        </motion.span>

        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={message}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.26, ease: "easeOut" }}
            className="truncate text-foreground/90"
          >
            {message}
          </motion.span>
        </AnimatePresence>

        {beruf && (
          <span className="ml-auto hidden shrink-0 items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[10px] font-medium text-foreground sm:inline-flex">
            <span className="h-1 w-1 rounded-full bg-primary" aria-hidden />
            {beruf.short ?? beruf.label}
          </span>
        )}
      </motion.div>
    </div>
  );
}
