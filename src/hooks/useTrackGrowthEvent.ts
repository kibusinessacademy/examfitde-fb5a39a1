import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

type GrowthEventType =
  | 'paywall_view'
  | 'cta_click'
  | 'checkout_started'
  | 'checkout_completed'
  | 'dismissed';

/**
 * Thin tracking hook for growth/conversion events.
 * Writes to conversion_events via service-level insert.
 * Fire-and-forget: never blocks UI.
 */
export function useTrackGrowthEvent() {
  const { user } = useAuth();

  const track = useCallback(
    (eventType: GrowthEventType, metadata?: Record<string, unknown>) => {
      if (!user) return;

      supabase
        .from('conversion_events')
        .insert({
          user_id: user.id,
          event_type: eventType,
          metadata: metadata ?? {},
        } as any)
        .then(() => {});
    },
    [user]
  );

  return { track };
}
