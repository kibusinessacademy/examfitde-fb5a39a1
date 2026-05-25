import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useSystemConsciousness } from "@/lib/system/SystemConsciousness";
import { companionMessageFor, isOsSurface } from "@/lib/os/os-copy";
import { useActiveCourse } from "@/contexts/ActiveCourseContext";

/**
 * OS Companion Bar — der ruhige, antizipierende Strip an der Oberkante.
 *
 * Eine einzige Zeile, die zeigt, dass das System mitdenkt. Surface-aware
 * (Landing, Pruefungscheck, /app). Liest aus SystemConsciousness + Active-Course.
 * Hat Vorrang vor dem alten SystemConsciousnessOverlay-Top-Strip.
 *
 * Verhalten:
 *  - eine Zeile, leise, niemals Notification
 *  - typing-in Reveal beim Wechsel der Aussage (250 ms)
 *  - reagiert auf Recalc-Events mit kurzem Sparkle-Pulse
 */

const TYPING_MS = 260;

function safeUseActiveCourse() {
  try {
    return useActiveCourse();
  } catch {
    return { active: null } as { active: { title?: string | null } | null };
  }
}

export default function OSCompanionBar() {
  const { pathname } = useLocation();
  const { readiness, lastRecalc, topRisks } = useSystemConsciousness();
  const active = safeUseActiveCourse();

  const beruf = active?.active?.title ?? null;
  const top = topRisks(1)[0];
  const urgent = top?.tone === "critical";

  const message = useMemo(
    () => companionMessageFor(pathname, { beruf, readiness, urgent }),
    [pathname, beruf, readiness, urgent],
  );

  const [pulse, setPulse] = useState(false);
  const [shownMessage, setShownMessage] = useState(message);

  // Typing-in reveal on message change
  useEffect(() => {
    setShownMessage(message);
  }, [message]);

  // Sparkle-pulse on recalc
  useEffect(() => {
    if (!lastRecalc) return;
    setPulse(true);
    const t = window.setTimeout(() => setPulse(false), 1400);
    return () => window.clearTimeout(t);
  }, [lastRecalc]);

  if (!isOsSurface(pathname)) return null;
  // Ergebnis-Surface hat eigene Helden — Bar dort ausblenden
  if (pathname === "/" || pathname === "") {
    // landing: nur ab oben sichtbar wenn nicht gescrollt? -> einfach immer, ist dezent
  }

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center px-3 pt-[max(0.5rem,env(safe-area-inset-top))]"
      aria-hidden={false}
    >
      <div className="pointer-events-auto flex max-w-2xl flex-1 items-center gap-2 rounded-full border border-border/50 bg-card/75 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur-md">
        <motion.span
          animate={pulse ? { scale: [1, 1.15, 1], rotate: [0, 6, 0] } : { scale: 1, rotate: 0 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
          className="inline-flex shrink-0"
          aria-hidden
        >
          <Sparkles
            className={`h-3.5 w-3.5 ${pulse ? "text-primary" : "opacity-70"}`}
          />
        </motion.span>

        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={shownMessage}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: TYPING_MS / 1000, ease: "easeOut" }}
            className="truncate text-foreground/90"
          >
            {shownMessage}
          </motion.span>
        </AnimatePresence>

        {beruf && (
          <span className="ml-auto hidden shrink-0 items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[10px] font-medium text-foreground sm:inline-flex">
            <span className="h-1 w-1 rounded-full bg-primary" aria-hidden />
            {beruf}
          </span>
        )}
      </div>
    </div>
  );
}
