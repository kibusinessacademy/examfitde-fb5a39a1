import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLocation } from "react-router-dom";
import { Brain, Radar } from "lucide-react";
import {
  daysSince,
  readinessLabel,
  riskToneClasses,
  useSystemConsciousness,
} from "@/lib/system/SystemConsciousness";

/**
 * Phase 5.8 — globaler System-Memory-Strip + stille Recalc-Toasts.
 *
 * Wird NUR auf /app/* + /pruefungsreife-ergebnis/* gemountet. Trägt das
 * Bewusstsein des Systems über Surface-Grenzen hinweg sichtbar — ruhig,
 * minimal, diagnostisch. Keine Notifications, keine KPI-Wand.
 */

const ENABLED_PREFIXES = ["/app/", "/pruefungsreife-ergebnis/"];

function isSurfaceRoute(pathname: string): boolean {
  if (pathname === "/app" || pathname === "/app/") return true;
  return ENABLED_PREFIXES.some((p) => pathname.startsWith(p));
}

export default function SystemConsciousnessOverlay() {
  const { pathname } = useLocation();
  const { topRisks, readiness, lastRecalc, memory } = useSystemConsciousness();
  const [recalcVisible, setRecalcVisible] = useState(false);
  const [lastShownId, setLastShownId] = useState<string | null>(null);

  // Recalc-Toast: ruhig, selten, ~2.4s
  useEffect(() => {
    if (!lastRecalc || lastRecalc.id === lastShownId) return;
    setRecalcVisible(true);
    setLastShownId(lastRecalc.id);
    const t = window.setTimeout(() => setRecalcVisible(false), 2400);
    return () => window.clearTimeout(t);
  }, [lastRecalc, lastShownId]);

  if (!isSurfaceRoute(pathname)) return null;

  const top = topRisks(1)[0];
  const latestMemory = memory[0];

  return (
    <>
      {/* Persistenter System-Memory-Strip — top, mobile-first, hinter Headern */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center px-3 pt-[max(0.5rem,env(safe-area-inset-top))]"
        aria-hidden={false}
      >
        <div className="pointer-events-auto flex max-w-2xl flex-1 items-center gap-2 rounded-full border border-border/50 bg-card/70 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur-md">
          <Brain className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          <span className="hidden shrink-0 font-medium text-foreground sm:inline">
            {readiness}% · {readinessLabel(readiness)}
          </span>
          <span className="hidden h-3 w-px shrink-0 bg-border/60 sm:inline-block" />
          {top && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${riskToneClasses(
                top.tone,
              )}`}
            >
              <span className="h-1 w-1 rounded-full bg-current" aria-hidden />
              {top.label}
              <span className="opacity-60">· seit {daysSince(top.since)}d</span>
            </span>
          )}
          {latestMemory && (
            <span className="ml-auto hidden truncate text-[10px] text-muted-foreground/80 sm:inline">
              {latestMemory.source}: {latestMemory.text}
            </span>
          )}
        </div>
      </div>

      {/* Recalc-Toast — bottom, ruhig, kein Notification-Feeling */}
      <AnimatePresence>
        {recalcVisible && lastRecalc && (
          <motion.div
            key={lastRecalc.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="pointer-events-none fixed inset-x-0 bottom-[max(5rem,env(safe-area-inset-bottom))] z-30 flex justify-center px-3"
          >
            <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/80 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
              <Radar className="h-3.5 w-3.5 animate-pulse text-primary" aria-hidden />
              <span className="font-medium text-foreground">{lastRecalc.message}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
