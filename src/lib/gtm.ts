/**
 * GTM / GA4 SSOT
 * Container: GTM-K39CL625
 * - Pushes typed events to window.dataLayer
 * - Consent Mode v2 default is set in index.html BEFORE GTM loads.
 * - Debug mode: append `?gtm_debug=1` OR `?gtm_preview=...` to URL,
 *   or set localStorage('ef_gtm_debug','1'). When active, every push
 *   is also console.log'd with prefix [GTM].
 */

type DataLayerArgs = Record<string, unknown> | unknown[];

declare global {
  interface Window {
    dataLayer?: DataLayerArgs[];
    gtag?: (...args: unknown[]) => void;
  }
}

export const GTM_ID = "GTM-K39CL625";

function isDebug(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const sp = new URLSearchParams(window.location.search);
    if (sp.has("gtm_debug") || sp.has("gtm_preview")) return true;
    return localStorage.getItem("ef_gtm_debug") === "1";
  } catch {
    return false;
  }
}

/** Low-level push — never throws. */
export function gtmPush(payload: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(payload);
    if (isDebug()) {
      // eslint-disable-next-line no-console
      console.log("[GTM]", payload);
    }
  } catch {
    /* noop — tracking must never break UI */
  }
}

/** SPA pageview — fire on every route change. */
export function gtmPageView(pagePath: string, pageTitle?: string): void {
  gtmPush({
    event: "spa_pageview",
    page_path: pagePath,
    page_location:
      typeof window !== "undefined" ? window.location.href : pagePath,
    page_title:
      pageTitle ?? (typeof document !== "undefined" ? document.title : ""),
  });
}

// ───────────────────────── H5P / Lerninhalte ─────────────────────────
export type H5PEvent =
  | "h5p_started"
  | "h5p_answered"
  | "h5p_completed"
  | "h5p_progress";

export function trackH5P(
  event: H5PEvent,
  params: {
    contentId: string;
    curriculumId?: string | null;
    score?: number | null;
    maxScore?: number | null;
    progressPct?: number | null;
    success?: boolean | null;
  }
): void {
  gtmPush({
    event,
    h5p_content_id: params.contentId,
    curriculum_id: params.curriculumId ?? null,
    score: params.score ?? null,
    max_score: params.maxScore ?? null,
    progress_pct: params.progressPct ?? null,
    success: params.success ?? null,
  });
}

// ───────────────────────── Prüfungstraining ─────────────────────────
export function trackExamStarted(params: {
  blueprintId?: string | null;
  curriculumId?: string | null;
  mode?: string | null;
  sessionId?: string | null;
}): void {
  gtmPush({
    event: "pruefung_begonnen",
    blueprint_id: params.blueprintId ?? null,
    curriculum_id: params.curriculumId ?? null,
    exam_mode: params.mode ?? null,
    exam_session_id: params.sessionId ?? null,
  });
}

export function trackExamCompleted(params: {
  sessionId?: string | null;
  curriculumId?: string | null;
  scorePct: number | null;
  passed: boolean | null;
  totalQuestions?: number | null;
  correctAnswers?: number | null;
}): void {
  gtmPush({
    event: "pruefung_abgeschlossen",
    exam_session_id: params.sessionId ?? null,
    curriculum_id: params.curriculumId ?? null,
    score_percentage: params.scorePct,
    passed: params.passed,
    total_questions: params.totalQuestions ?? null,
    correct_answers: params.correctAnswers ?? null,
  });
  // Conversion: pass/fail
  if (params.passed === true) {
    gtmPush({
      event: "bestanden",
      exam_session_id: params.sessionId ?? null,
      curriculum_id: params.curriculumId ?? null,
      score_percentage: params.scorePct,
    });
  } else if (params.passed === false) {
    gtmPush({
      event: "nicht_bestanden",
      exam_session_id: params.sessionId ?? null,
      curriculum_id: params.curriculumId ?? null,
      score_percentage: params.scorePct,
    });
  }
}

// ───────────────────────── Consent Mode v2 ─────────────────────────
export type ConsentDecision = {
  analytics: boolean;
  ad: boolean;
};

const CONSENT_KEY = "ef_consent_v1";

export function getStoredConsent(): ConsentDecision | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ConsentDecision;
  } catch {
    return null;
  }
}

export function setConsent(decision: ConsentDecision): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(decision));
  } catch {
    /* noop */
  }
  if (typeof window.gtag === "function") {
    window.gtag("consent", "update", {
      ad_storage: decision.ad ? "granted" : "denied",
      ad_user_data: decision.ad ? "granted" : "denied",
      ad_personalization: decision.ad ? "granted" : "denied",
      analytics_storage: decision.analytics ? "granted" : "denied",
    });
  }
  gtmPush({
    event: "consent_update",
    consent_analytics: decision.analytics,
    consent_ad: decision.ad,
  });
}

// ───────────────────────── Funnel Fan-out (DataLayer-First) ─────────────────────────
/**
 * Maps internal FunnelEventType (conversion_events SSOT) to the canonical
 * GTM event name used in the GTM container. Frontend keeps writing one event
 * via `trackFunnel(...)` — this layer mirrors it to `window.dataLayer` so GTM
 * can fan out to GA4 / Google Ads / Meta / Matomo / etc. without React-Code-Edits.
 *
 * Rule: Frontend pusht NUR DataLayer-Events. Pixel-Logik lebt im GTM-Container.
 */
const FUNNEL_TO_GTM_EVENT: Record<string, string> = {
  hero_cta_click: "cta_clicked",
  cta_clicked: "cta_clicked",
  cta_visible: "cta_visible",
  pricing_view: "pricing_view",
  page_view: "landing_view",
  add_to_cart: "add_to_cart",
  checkout_start: "checkout_started",
  checkout_complete: "purchase_completed",
  lead_magnet_view: "lead_magnet_viewed",
  lead_magnet_download: "lead_magnet_downloaded",
  quiz_started: "quiz_started",
  quiz_start: "quiz_started",
  quiz_completed: "quiz_completed",
  quiz_complete: "quiz_completed",
  quiz_cta_clicked: "cta_clicked",
  bundle_cta_clicked: "cta_clicked",
  lead_capture_submitted: "lead_captured",
  lernplan_viewed: "lernplan_viewed",
  doi_confirmed: "doi_confirmed",
  course_open: "course_opened",
  exam_attempt: "exam_attempt",
  heatmap_click: "heatmap_click",
  heatmap_scroll_depth: "scroll_depth",
  // Legacy-Aliase (DB akzeptiert weiterhin) — explizit gemappt, damit
  // GTM-Event-Mapping-Guard nicht fault. Nicht mehr neu emittieren.
  lead_capture: "lead_captured",
  lernplan_view: "lernplan_viewed",
  optin_submit: "lead_captured",
  b2b_form_submit: "lead_captured",
};

export type FunnelDataLayerPayload = {
  package_id?: string | null;
  persona?: string | null;
  curriculum_id?: string | null;
  source_page?: string | null;
  page_path?: string | null;
  metadata?: Record<string, unknown> | null;
};

/** Fan-out helper: ein FunnelEvent → DataLayer-Push mit kanonischen Top-Level-Feldern. */
export function gtmEmitFunnel(
  funnelEventType: string,
  opts: FunnelDataLayerPayload = {}
): void {
  const gtmEvent = FUNNEL_TO_GTM_EVENT[funnelEventType] ?? funnelEventType;
  gtmPush({
    event: gtmEvent,
    funnel_event: funnelEventType,
    package_id: opts.package_id ?? null,
    persona: opts.persona ?? null,
    curriculum_id: opts.curriculum_id ?? null,
    source_page: opts.source_page ?? null,
    page_path:
      opts.page_path ??
      (typeof window !== "undefined" ? window.location.pathname : null),
    ...(opts.metadata ?? {}),
  });
}

// ───────────────────────── Standalone Catalog Helpers ─────────────────────────
// Für Events außerhalb von trackFunnel/conversion_events (rein UX/Engagement).

export function trackPersonaSelected(persona: string, source_page?: string): void {
  gtmPush({
    event: "persona_selected",
    persona,
    source_page: source_page ?? (typeof window !== "undefined" ? window.location.pathname : null),
  });
}

export function trackAiTutorUsed(params: {
  packageId?: string | null;
  curriculumId?: string | null;
  intent?: string | null;
  hasCitations?: boolean | null;
}): void {
  gtmPush({
    event: "ai_tutor_used",
    package_id: params.packageId ?? null,
    curriculum_id: params.curriculumId ?? null,
    intent: params.intent ?? null,
    has_citations: params.hasCitations ?? null,
  });
}

export function trackOralExamStarted(params: {
  packageId?: string | null;
  curriculumId?: string | null;
  sessionId?: string | null;
}): void {
  gtmPush({
    event: "oral_exam_started",
    package_id: params.packageId ?? null,
    curriculum_id: params.curriculumId ?? null,
    exam_session_id: params.sessionId ?? null,
  });
}

export function trackMasteryReached(params: {
  packageId?: string | null;
  curriculumId?: string | null;
  competencyId?: string | null;
  masteryLevel: number;
}): void {
  gtmPush({
    event: "mastery_reached",
    package_id: params.packageId ?? null,
    curriculum_id: params.curriculumId ?? null,
    competency_id: params.competencyId ?? null,
    mastery_level: params.masteryLevel,
  });
}

export function trackExamSimulationStarted(params: {
  packageId?: string | null;
  curriculumId?: string | null;
  blueprintId?: string | null;
  mode?: string | null;
}): void {
  gtmPush({
    event: "exam_simulation_started",
    package_id: params.packageId ?? null,
    curriculum_id: params.curriculumId ?? null,
    blueprint_id: params.blueprintId ?? null,
    exam_mode: params.mode ?? null,
  });
}
