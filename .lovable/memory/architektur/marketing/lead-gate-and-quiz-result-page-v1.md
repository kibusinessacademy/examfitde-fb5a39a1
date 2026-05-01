---
name: Lead-Gate Soft-Nudge & Diagnose-Ergebnis-Seite
description: Soft-Gate vor Checkout (kein Hard-Block) + /pruefungsreife-ergebnis/:attemptId mit deriveRecommendation. Nutzt non-legacy Access-RPC.
type: feature
---

# Lead-Gate + Diagnose-Ergebnis (Sprint 2 Step 2)

## Lead-Gate Soft-Nudge

- `useLeadGate({ curriculumId?, enabled? })` prüft `quiz_attempts` für aktuellen
  `user_id` (oder `anonymous_id`) in den letzten 30 Tagen, optional gefiltert
  nach `curriculum_id`.
- `LeadGateModal` rendert das Soft-Gate. Pflicht-Events (über
  `useTrackGrowthEvent` → `conversion_events`):
  - `lead_gate_shown` (mount)
  - `lead_gate_start_diagnosis` (Primary)
  - `lead_gate_skip_to_checkout` (Secondary)
- Verdrahtet in:
  - `src/pages/landing/PersonaLandingPage.tsx` (`handleCheckout`)
  - `src/pages/landing/DynamicProductLandingPage.tsx` (`handlePrimaryCta`)
- Hard-Block ist verboten. Skip führt unverändert zu `startProductCheckout`.

## Diagnose-Ergebnis-Seite

- Route: `/pruefungsreife-ergebnis/:attemptId` (`AppRoutes.tsx`).
- Komponente: `src/pages/quiz/QuizResultPage.tsx`.
- SSOT-Lesepfad: `quiz_attempts` (+ Fallback `lead_quizzes.curriculum_id`)
  → `course_packages` (status='published', match curriculum_id)
  → `products.slug` für Checkout-Target.
- `score` in DB = 0..1 → Anzeige × 100.
- `deriveRecommendation(scorePercent)`:
  - `<50` → learn → `/app/package/:id/lernen`
  - `50–74` → train → `/app/package/:id/trainer`
  - `≥75` → simulate → `/app/package/:id/simulation`
- Ohne Entitlement: CTA → `/checkout/:productSlug?source=quiz_result&attempt_id=…`.
- Access-Check via `check_product_access_by_curriculum` (NICHT `check_user_entitlement`
  — das ist legacy/banned, vgl. `no-legacy-entitlement-rpc-guard`). Bei
  fehlender RPC oder anonym = `hasAccess=false` → User wird zur Bundle-Paywall
  geführt (Soft-Conversion).
- Tracking-Pflichtevents:
  - `quiz_result_viewed` (mount, mit `package_id`, `score_percent`,
    `mastery_level`, `recommended_mode`, `has_access`)
  - `result_cta_clicked` (Click)
- Page ist `noindex` (private Diagnose-Sicht).
- LeadQuizRunner zeigt nach Quiz-Completion **zusätzlich** einen Link
  "Detailliertes Ergebnis & Empfehlung ansehen" auf `/pruefungsreife-ergebnis/:attemptId`.
  Lead-Capture-Form bleibt erhalten (kein destruktiver Refactor).

## Bekannte Lücken / Folgeschritte

- `course_packages.persona_profile` wird im Result aktuell nicht für
  CTA-Variation genutzt — kommt in Iteration 2.
- `competency_breakdown`/`weakest_competencies` fehlen in der UI; sobald
  `quiz_attempts.answers` mit Topic-Tags pro Frage stabil persistiert ist,
  Top-3-Risiken einblenden.
- `can_access_product` / `check_product_access_by_curriculum` existieren
  derzeit nicht in `public` (Stand 2026-05-01) — Access-Check fällt deshalb
  in der Praxis immer auf `false` zurück. Sobald die RPCs deployed sind, greift
  der Direct-Learning-Mode-Pfad ohne Codeänderung.
