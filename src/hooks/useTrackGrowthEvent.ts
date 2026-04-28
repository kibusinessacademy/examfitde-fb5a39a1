import { useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

type GrowthEventType =
  | 'paywall_view'
  | 'cta_click'
  | 'checkout_started'
  | 'checkout_completed'
  | 'dismissed'
  | 'pricing_hero_view'
  | 'pricing_hero_primary_click'
  | 'pricing_hero_secondary_click'
  // v3 funnel granularity
  | 'shop_view'
  | 'product_search'
  | 'product_filter'
  | 'product_view'
  | 'product_select'
  | 'checkout_start';

const ANON_KEY = 'examfit_anon_id';
const SESS_KEY = 'examfit_session_id';

function getAnonId(): string {
  if (typeof window === 'undefined') return 'ssr';
  let v = localStorage.getItem(ANON_KEY);
  if (!v) {
    v = `a_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(ANON_KEY, v);
  }
  return v;
}

function getSessionId(): string {
  if (typeof window === 'undefined') return 'ssr';
  let v = sessionStorage.getItem(SESS_KEY);
  if (!v) {
    v = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(SESS_KEY, v);
  }
  return v;
}

interface TrackOpts {
  curriculumId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Tracking hook for growth/conversion/funnel events.
 * Writes to conversion_events. Anonymous-friendly (uses anon_id + session_id).
 * Fire-and-forget: never blocks UI.
 */
export function useTrackGrowthEvent() {
  const { user } = useAuth();
  // Track the previous step's timestamp per session for client-side latency metadata.
  const lastStepAt = useRef<number | null>(null);

  const track = useCallback(
    (eventType: GrowthEventType, opts: TrackOpts = {}) => {
      const now = Date.now();
      const sinceLastMs = lastStepAt.current ? now - lastStepAt.current : null;
      lastStepAt.current = now;

      const payload: any = {
        user_id: user?.id ?? null,
        anonymous_id: user ? null : getAnonId(),
        session_id: getSessionId(),
        event_type: eventType,
        curriculum_id: opts.curriculumId ?? null,
        page_path: typeof window !== 'undefined' ? window.location.pathname : null,
        metadata: {
          ...(opts.metadata ?? {}),
          since_last_step_ms: sinceLastMs,
          ts_client: now,
        },
      };

      // Only authenticated users may insert under current RLS;
      // for anon, fall through silently (the page-level analytics view will still
      // capture authed sessions, which is what the admin funnel view shows).
      if (!user) return;

      supabase
        .from('conversion_events')
        .insert(payload as any)
        .then(() => {});
    },
    [user]
  );

  return { track };
}
