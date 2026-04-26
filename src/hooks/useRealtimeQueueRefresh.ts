/**
 * Live-Refresh-Hook für Admin-Cockpit Queue-Ansichten.
 *
 * Hört auf postgres_changes der job_queue (alle Events) und invalidiert
 * gezielt die Query-Keys, die die "Empfohlene Aktionen"-Cluster, Health-Score
 * und Counts speisen. Verhindert sogenannte Phantom-Cluster (z. B.
 * UNCLASSIFIED_EMPTY) durch veraltete React-Query-Caches.
 *
 * Throttle: max. ein Invalidate pro 1.5 s, damit Burst-Updates nicht
 * hunderte Re-Fetches auslösen.
 */
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const DEFAULT_KEYS: ReadonlyArray<readonly unknown[]> = [
  ["queue-recommended-actions"],
  ["queue-health-score"],
  ["queue-system-healthcheck-allowed-clusters"],
  ["queue-health"],
  ["queue-counts"],
  ["active-repair-jobs"],
  ["admin-queue-ssot"],
  ["admin"],
];

export interface UseRealtimeQueueRefreshOptions {
  /** Zusätzliche Query-Keys, die bei Updates invalidiert werden sollen. */
  extraKeys?: ReadonlyArray<readonly unknown[]>;
  /** Throttle-Fenster in ms (Default 1500). */
  throttleMs?: number;
  /** Realtime an/aus (Default true). */
  enabled?: boolean;
}

export function useRealtimeQueueRefresh(
  opts: UseRealtimeQueueRefreshOptions = {},
): void {
  const { extraKeys = [], throttleMs = 1500, enabled = true } = opts;
  const qc = useQueryClient();
  const lastFlush = useRef(0);
  const pending = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const flush = () => {
      lastFlush.current = Date.now();
      pending.current = null;
      for (const key of DEFAULT_KEYS) {
        qc.invalidateQueries({ queryKey: key as unknown[] });
      }
      for (const key of extraKeys) {
        qc.invalidateQueries({ queryKey: key as unknown[] });
      }
    };

    const schedule = () => {
      const now = Date.now();
      const wait = Math.max(0, throttleMs - (now - lastFlush.current));
      if (pending.current != null) return;
      pending.current = window.setTimeout(flush, wait);
    };

    const channel = supabase
      .channel("realtime-queue-cockpit")
      .on(
        "postgres_changes" as never,
        { event: "*", schema: "public", table: "job_queue" } as never,
        schedule,
      )
      .subscribe();

    return () => {
      if (pending.current != null) {
        window.clearTimeout(pending.current);
        pending.current = null;
      }
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, enabled, throttleMs]);
}
