/**
 * useLeadGate — entscheidet, ob vor dem Checkout ein Soft-Nudge zur Diagnose
 * gezeigt werden muss. Hard-Block ist NICHT Ziel: User darf jederzeit
 * weiterkaufen ("skip_to_checkout").
 *
 * Kriterium "darf direkt kaufen": es existiert ein quiz_attempt für das
 * passende curriculum_id (anonym oder authed) innerhalb der letzten 30 Tage.
 *
 * SSOT: Wir prüfen nur quiz_attempts. Keine Parallel-Tabelle.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getAnonymousId } from "@/lib/conversionTracking";
import { useAuth } from "@/hooks/useAuth";

const RECENT_DAYS = 30;

export interface LeadGateState {
  loading: boolean;
  /** true = darf direkt kaufen (recent attempt found), Modal NICHT zeigen. */
  hasRecentAttempt: boolean;
}

export function useLeadGate(curriculumId: string | null | undefined): LeadGateState {
  const { user } = useAuth();
  const [loading, setLoading] = useState<boolean>(Boolean(curriculumId));
  const [hasRecentAttempt, setHasRecentAttempt] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!curriculumId) {
      setLoading(false);
      setHasRecentAttempt(false);
      return;
    }
    setLoading(true);

    (async () => {
      const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const anonId = user ? null : getAnonymousId();

      let q = (supabase as any)
        .from("quiz_attempts")
        .select("id", { head: true, count: "exact" })
        .eq("curriculum_id", curriculumId)
        .gte("started_at", since);

      if (user) {
        q = q.eq("user_id", user.id);
      } else if (anonId) {
        q = q.eq("anonymous_id", anonId);
      } else {
        if (!cancelled) {
          setHasRecentAttempt(false);
          setLoading(false);
        }
        return;
      }

      const { count, error } = await q;
      if (cancelled) return;
      if (error) {
        // Tolerant: bei Fehler lieber Modal zeigen (Soft-Nudge), nicht blocken.
        setHasRecentAttempt(false);
      } else {
        setHasRecentAttempt((count ?? 0) > 0);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [curriculumId, user?.id]);

  return { loading, hasRecentAttempt };
}
