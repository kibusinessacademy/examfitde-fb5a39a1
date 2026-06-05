/**
 * Entry-Fallback Monitoring Signal (P0.4 follow-up, 2026-06-05).
 *
 * Emits a small, structured signal whenever one of the three Reality-QA
 * entry/recovery surfaces (MiniCheck, Tutor, Oral Exam) is shown in
 * production. Lets us see *empty states* in real user sessions immediately
 * — without waiting for the daily Customer Reality Gate.
 *
 * Surfaces:
 *   - 'minicheck'  → /minicheck and /minicheck/:sessionId entry page
 *   - 'tutor'      → /tutor entry page (recovery + input)
 *   - 'oral'       → /oral-exam setup phase (incl. no-curriculum recovery)
 *
 * States:
 *   - 'ready'    → surface rendered with usable context (sessionId, curriculum, …)
 *   - 'recovery' → surface rendered as recovery (no context → Beruf-Wahl CTA)
 *
 * Event names:
 *   - entry_fallback_view       (on mount, debounced per session + surface + state)
 *   - entry_fallback_cta_click  (on Start / Recovery CTA click)
 *
 * Sinks:
 *   - tracking_events table via trackEvent() (existing SSOT)
 *   - console.info() with stable `[entry-fallback]` prefix → grep-able in
 *     browser console + Sentry breadcrumbs.
 *
 * Never throws, never blocks UX.
 */
import { trackEvent } from '@/lib/tracking/track';

export type EntryFallbackSurface = 'minicheck' | 'tutor' | 'oral';
export type EntryFallbackState = 'ready' | 'recovery';
export type EntryFallbackCta =
  | 'minicheck_start'
  | 'minicheck_recovery'
  | 'tutor_submit'
  | 'tutor_recovery'
  | 'oral_start'
  | 'oral_recovery';

const SEEN = new Set<string>();

function logToConsole(eventName: string, payload: Record<string, unknown>) {
  try {
    // eslint-disable-next-line no-console
    console.info('[entry-fallback]', eventName, payload);
  } catch {
    /* ignore */
  }
}

/**
 * Fire once per (surface, state) per page session. Mount-time signal.
 */
export function reportEntryFallbackView(
  surface: EntryFallbackSurface,
  state: EntryFallbackState,
  extra: Record<string, unknown> = {},
) {
  const key = `${surface}:${state}`;
  if (SEEN.has(key)) return;
  SEEN.add(key);

  const payload = {
    surface,
    state,
    path: typeof window !== 'undefined' ? window.location.pathname : null,
    ts: new Date().toISOString(),
    ...extra,
  };
  logToConsole('entry_fallback_view', payload);
  void trackEvent({
    eventName: 'entry_fallback_view',
    metadata: payload,
  });
}

/**
 * Fire on CTA click inside an entry/recovery surface.
 */
export function reportEntryFallbackCtaClick(
  surface: EntryFallbackSurface,
  cta: EntryFallbackCta,
  extra: Record<string, unknown> = {},
) {
  const payload = {
    surface,
    cta,
    path: typeof window !== 'undefined' ? window.location.pathname : null,
    ts: new Date().toISOString(),
    ...extra,
  };
  logToConsole('entry_fallback_cta_click', payload);
  void trackEvent({
    eventName: 'entry_fallback_cta_click',
    metadata: payload,
  });
}

/** Test helper — resets the per-session dedupe cache. */
export function __resetEntryFallbackSignalForTests() {
  SEEN.clear();
}
