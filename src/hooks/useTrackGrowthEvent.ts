import { useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export type GrowthEventType =
  | 'paywall_view'
  | 'cta_click'
  | 'checkout_started'
  | 'checkout_completed'
  | 'dismissed'
  | 'pricing_hero_view'
  | 'pricing_hero_primary_click'
  | 'pricing_hero_secondary_click'
  | 'shop_view'
  | 'product_search'
  | 'product_filter'
  | 'product_view'
  | 'product_select'
  | 'checkout_start'
  // SSOT v2 paketgebundene Funnel-Events
  | 'lead_magnet_view'
  | 'lead_capture_view'
  | 'quiz_started'
  | 'quiz_completed'
  | 'lead_capture_submitted';

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

type TrackOpts = Record<string, unknown> & {
  curriculumId?: string | null;
  /** SSOT: paketgebundene Events benötigen das. */
  packageId?: string | null;
  /** Persona-Kontext (azubi/betrieb/institution …) */
  persona?: string | null;
  /** Quelle (z.B. canonical SEO-Pfad) */
  sourcePage?: string | null;
  metadata?: Record<string, unknown>;
};

const PACKAGE_REQUIRED: ReadonlySet<GrowthEventType> = new Set([
  // lead_magnet_view bewusst optional → unmatched-Drop messbar.
  'quiz_started',
  'quiz_completed',
  'lead_capture_submitted',
]);

/**
 * Tracking hook — SSOT v2.
 * - authed users: direkter insert in conversion_events
 * - anonymous users: edge function track-funnel-event (RLS-bypass via service-role)
 * - paketgebundene Events erzwingen package_id (warning in dev, server validates)
 */
export function useTrackGrowthEvent() {
  const { user } = useAuth();
  const lastStepAt = useRef<number | null>(null);

  const track = useCallback(
    (eventType: GrowthEventType, opts: TrackOpts = {}) => {
      const now = Date.now();
      const sinceLastMs = lastStepAt.current ? now - lastStepAt.current : null;
      lastStepAt.current = now;

      const {
        curriculumId,
        packageId,
        persona,
        sourcePage,
        metadata: nestedMeta,
        ...flatMeta
      } = opts;

      if (PACKAGE_REQUIRED.has(eventType) && !packageId && import.meta.env.DEV) {
        // dev hint — server enforces 400
        // eslint-disable-next-line no-console
        console.warn(`[track] ${eventType} requires packageId`);
      }

      const pagePath = typeof window !== 'undefined' ? window.location.pathname : null;
      const metadata = {
        ...flatMeta,
        ...(nestedMeta ?? {}),
        since_last_step_ms: sinceLastMs,
        ts_client: now,
      };

      // Unified path: nutze Edge Function für authed UND anon.
      // Grund: vermeidet RLS-Edgecases + identische Validierung serverseitig.
      // package_id ist (noch) keine Spalte in conversion_events → in metadata.
      supabase.functions
        .invoke('track-funnel-event', {
          body: {
            event_type: eventType,
            user_id: user?.id ?? null,
            anonymous_id: user ? null : getAnonId(),
            session_id: getSessionId(),
            curriculum_id: curriculumId ?? null,
            package_id: packageId ?? null,
            persona: persona ?? null,
            source_page: sourcePage ?? null,
            page_path: pagePath,
            metadata,
          },
        })
        .then(() => {});
    },
    [user]
  );

  return { track };
}
