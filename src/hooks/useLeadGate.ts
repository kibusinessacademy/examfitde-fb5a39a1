/**
 * useLeadGate — entscheidet, ob vor dem Checkout ein Soft-Nudge zur Diagnose
 * gezeigt werden muss. Hard-Block ist NICHT Ziel: User darf jederzeit
 * weiterkaufen ("skip_to_checkout").
 *
 * Kriterium "darf direkt kaufen": es existiert ein quiz_attempt in den letzten
 * 30 Tagen, optional gefiltert auf curriculum_id (wenn bekannt).
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

export interface LeadGateOptions {
  /** Optional: schränkt den Recency-Check auf ein curriculum_id ein. */
  curriculumId?: string | null;
  /** Master-Switch — ermöglicht das Deaktivieren des Hooks. */
  enabled?: boolean;
}

export function useLeadGate(options: LeadGateOptions = {}): LeadGateState {
  const { curriculumId = null, enabled = true } = options;
  const { user } = useAuth();
  const [loading, setLoading] = useState<boolean>(enabled);
  const [hasRecentAttempt, setHasRecentAttempt] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
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
        .gte("started_at", since);

      if (curriculumId) q = q.eq("curriculum_id", curriculumId);

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
  }, [curriculumId, enabled, user?.id]);

  return { loading, hasRecentAttempt };
}

