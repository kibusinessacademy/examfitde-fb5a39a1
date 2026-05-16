import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const SESSION_FLAG = "ef_nj_session_started";

/**
 * Track 5 Phase 4 — Notification Attribution.
 * Reads ?nj=<job_id>&nj_k=<kind> appended by the push service worker on
 * notificationclick, records opened + reentry + session_started_from_notification
 * via record_notification_event RPC (idempotent), then strips the params.
 *
 * Mount once at app root (inside <BrowserRouter>).
 */
export function useNotificationAttribution() {
  const loc = useLocation();
  const nav = useNavigate();
  const processed = useRef<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(loc.search);
    const jobId = params.get("nj");
    if (!jobId) return;
    if (processed.current === jobId) return;
    processed.current = jobId;

    const kind = params.get("nj_k") ?? null;

    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const record = (evt: string, meta: Record<string, unknown> = {}) =>
          (supabase as any).rpc("record_notification_event", {
            p_job_id: jobId,
            p_event_type: evt,
            p_metadata: { kind, ...meta },
          });

        await record("notification_opened", { source: "push_sw", path: loc.pathname });
        await record("reentry_from_push", { path: loc.pathname });

        const sessionKey = `${SESSION_FLAG}:${jobId}`;
        if (!sessionStorage.getItem(sessionKey)) {
          sessionStorage.setItem(sessionKey, "1");
          await record("session_started_from_notification", { path: loc.pathname });
        }
      } catch {
        // never block UX
      } finally {
        // Strip attribution params from URL (keep other params intact)
        const clean = new URLSearchParams(loc.search);
        clean.delete("nj"); clean.delete("nj_k"); clean.delete("nj_t");
        const qs = clean.toString();
        nav({ pathname: loc.pathname, search: qs ? `?${qs}` : "", hash: loc.hash }, { replace: true });
      }
    })();
  }, [loc.search, loc.pathname, loc.hash, nav]);
}
