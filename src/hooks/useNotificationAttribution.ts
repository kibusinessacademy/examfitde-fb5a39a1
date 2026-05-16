import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const SESSION_FLAG = "ef_nj_session_started";
const CTA_FLAG = "ef_nj_cta_clicked";

/**
 * Track 5 Phase 4 + Track 2.2 — Notification Attribution.
 * Reads ?nj, ?nj_k, ?nj_cta appended by the push service worker on
 * notificationclick, records opened + reentry + session_started_from_notification
 * + cta_clicked via record_notification_event RPC (idempotent), strips params.
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
    const isCta = params.get("nj_cta") === "1";

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

        if (isCta) {
          const ctaKey = `${CTA_FLAG}:${jobId}`;
          if (!sessionStorage.getItem(ctaKey)) {
            sessionStorage.setItem(ctaKey, "1");
            await record("cta_clicked", { path: loc.pathname, surface: "push" });
          }
        }

        const sessionKey = `${SESSION_FLAG}:${jobId}`;
        if (!sessionStorage.getItem(sessionKey)) {
          sessionStorage.setItem(sessionKey, "1");
          await record("session_started_from_notification", { path: loc.pathname });
        }
      } catch {
        // never block UX
      } finally {
        const clean = new URLSearchParams(loc.search);
        clean.delete("nj"); clean.delete("nj_k"); clean.delete("nj_t"); clean.delete("nj_cta");
        const qs = clean.toString();
        nav({ pathname: loc.pathname, search: qs ? `?${qs}` : "", hash: loc.hash }, { replace: true });
      }
    })();
  }, [loc.search, loc.pathname, loc.hash, nav]);
}

/**
 * Track 2.2 — Goal-resolved producer.
 * Call after a learner completes an action that fulfils a notification intent
 * (e.g. MiniCheck for weak_competency_drill, course-resume for course_resumption).
 * Idempotent on the server (per job+event_type).
 */
export async function markNotificationIntentResolved(
  intentKey: string,
  metadata: Record<string, unknown> = {},
): Promise<number> {
  const { data, error } = await (supabase as any).rpc("learner_mark_intent_resolved", {
    p_intent_key: intentKey,
    p_metadata: metadata,
  });
  if (error) return 0;
  return typeof data === "number" ? data : 0;
}
