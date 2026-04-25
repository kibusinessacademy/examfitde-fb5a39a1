/**
 * Surfaces a contextual toast notification when an auto-publish job for a
 * given package is currently blocked, with a direct action that opens the
 * "Why blocked?" details panel.
 *
 * Block detection: a recent `step_done_meta_audit` row with `blocked = true`
 * for this package within the configured lookback window (default 10 min).
 */
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface UseAutoPublishBlockedToastOptions {
  packageId: string | null | undefined;
  /** Open the WhyBlocked modal for this package. */
  onOpenDetails: (packageId: string) => void;
  /** Lookback window in seconds. Default 600 (10 min). */
  lookbackSeconds?: number;
  /** Polling interval. Default 30s. */
  pollMs?: number;
  /** Disable entirely (e.g. modal already open). */
  enabled?: boolean;
}

export function useAutoPublishBlockedToast({
  packageId,
  onOpenDetails,
  lookbackSeconds = 600,
  pollMs = 30_000,
  enabled = true,
}: UseAutoPublishBlockedToastOptions) {
  // Toast id is keyed by the block row to avoid spamming the same block.
  const lastToastedRowRef = useRef<string | null>(null);

  const { data } = useQuery({
    enabled: enabled && !!packageId,
    queryKey: ['auto-publish-blocked', packageId, lookbackSeconds],
    refetchInterval: pollMs,
    queryFn: async () => {
      if (!packageId) return null;
      const since = new Date(Date.now() - lookbackSeconds * 1000).toISOString();
      const { data, error } = await supabase
        .from('step_done_meta_audit')
        .select('id, step_key, source_fn, created_at')
        .eq('package_id', packageId)
        .eq('blocked', true)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!data || !packageId) return;
    if (lastToastedRowRef.current === data.id) return;
    lastToastedRowRef.current = data.id;

    toast.warning('Auto-Publish blockiert', {
      description: `Step ${data.step_key} wurde von ${data.source_fn ?? 'unknown'} blockiert.`,
      duration: 12_000,
      action: {
        label: 'Details',
        onClick: () => onOpenDetails(packageId),
      },
    });
  }, [data, packageId, onOpenDetails]);
}
