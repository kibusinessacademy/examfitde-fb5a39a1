import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLocation } from "react-router-dom";
import { Radar } from "lucide-react";
import { useSystemConsciousness } from "@/lib/system/SystemConsciousness";

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

  // Top-Strip wird seit OS-Spine v1 von OSCompanionBar geführt — hier nur noch
  // der ruhige Recalc-Toast (bottom).
  return (
    <>


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
