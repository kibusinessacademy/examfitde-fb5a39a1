/**
 * Heal-Cockpit — Track-Applicability Hook
 *
 * Lädt die SSOT-Tabelle `track_step_applicability` einmalig in den Query-Cache
 * und stellt einen Lookup `isApplicable(track, stepKey)` bereit.
 *
 * Zweck: UI-seitig unzulässige Repair-Optionen ausblenden / disablen,
 * bevor der Backend-Guard (admin-ops-actions) mit HTTP 400 antwortet.
 */
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface TrackStepRule {
  track: string;
  step_key: string;
  should_run: boolean;
}

const QUERY_KEY = ["track-step-applicability"] as const;

async function fetchTrackApplicability(): Promise<TrackStepRule[]> {
  const { data, error } = await supabase
    .from("track_step_applicability" as never)
    .select("track, step_key, should_run");
  if (error) throw error;
  return (data ?? []) as unknown as TrackStepRule[];
}

export function useTrackApplicability() {
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchTrackApplicability,
    staleTime: 5 * 60_000, // 5 min — Tabelle ändert sich selten
    gcTime: 30 * 60_000,
  });

  const isApplicable = useCallback(
    (track: string | null | undefined, stepKey: string): boolean => {
      if (!track) return true; // unbekannter Track → nicht blockieren
      const rows = query.data ?? [];
      const rule = rows.find((r) => r.track === track && r.step_key === stepKey);
      // Default: erlaubt (falls Tabelle noch nicht geladen oder Regel fehlt)
      return rule ? rule.should_run : true;
    },
    [query.data],
  );

  return { ...query, isApplicable };
}
