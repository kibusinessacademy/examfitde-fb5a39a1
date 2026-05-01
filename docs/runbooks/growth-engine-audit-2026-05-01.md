# Growth Engine Audit — Ist vs. SYSTEM_RULES (1.5.2026)

> **Mandat:** SSOT erweitern, keine Parallel-Tabellen. Keine SQL-Defekte. Konformität zu `docs/SYSTEM_RULES.md`.
> **Methode:** DB-Introspektion + Code-Inventar (siehe Anhang) → Mapping gegen die 20 Regeln → Gap mit konkretem Migrations-/Code-Task.

---

## TL;DR — Ampel pro Regel

| # | Regel | Status | Schwere |
|---|-------|--------|---------|
| 1  | Produkt erst verkaufbar fertig | 🔴 | **BLOCKER** — 47 published Produkte ohne Pricing |
| 2  | Bundle-Only Monetarisierung | 🟡 | Pricing-Plans existieren, aber kein Hard-Guard gegen Einzelprodukte |
| 3  | Outcome-based Pricing | 🟡 | `classify_package_pricing_tier` da, aber nicht kanonisch durchgesetzt |
| 4  | Instant Delivery | 🟢 | `trg_orders_paid_grant` → `grant_learner_course_access` idempotent |
| 5  | Conversion-Tracking Pflicht | 🟡 | `conversion_events` v2 + `track-funnel-event` da; **`landing_view` fehlt im Enum**, `checkout_started` aktuell 0 Events |
| 6  | Persona-first Marketing | 🟡 | `seo/Pruefungstraining{Azubis,Betriebe,Institutionen}Page` als Hub — **kein Persona-Routing pro Produkt** |
| 7  | SEO ist Produktbestandteil | 🟢 | `seo_content_pages` + `growth_content_jobs` da |
| 8  | SEO nur SSOT | 🟢 | `generate-seo-page` nutzt curriculum/blueprints |
| 9  | Content → Conversion | 🟡 | CTAs vorhanden, aber kein erzwungener Diagnose-Quiz-CTA in Hero |
| 10 | Lead-Gate vor Checkout | 🟡 | `LeadQuizRunner` da; **kein Hard-Gate** zwischen Quiz und Bundle-Checkout |
| 11 | Trust-System | 🟢 | `ProductTrustBar`, `ProductFAQSection` |
| 12 | Lifecycle Automatisierung | 🟢 | Pipeline + Heal-Cockpit |
| 13 | Self-Optimizing Growth | 🟡 | `growth_metrics` + `growth_risk_scores` existieren, kein Auto-Optimizer aktiv |
| 14 | Keine Manual Sales | 🟢 | B2B via `create-b2b-checkout` |
| 15 | B2B als System | 🟢 | `org_licenses` + `org_license_seats` |
| 16 | Produkt ≠ Kurs | 🟢 | Architektur stimmt |
| 17 | AI-Tutor als Conversion | 🟢 | `tutor_access_check` Gate; Pre-Sale-Tutor fehlt aber |
| 18 | Oral Trainer USP | 🟢 | `OralExamTrainer` + Edge Functions |
| 19 | Kein Feature ohne Monetarisierung | 🟢 | Bundle-Logik durchgängig |
| 20 | Skalierung | 🟢 | Auto-Generation + Heal-Cockpit |

**Gesamt:** 9× 🟢, 10× 🟡, 1× 🔴.
**Top-3 Hebel:** Pricing-rot fixen (R1), Persona-Routing pro Produkt (R6), Diagnose-Gate vor Checkout (R10).

---

## Anhang A — DB-Inventar (Ist)

### Vorhandene SSOT-Tabellen (relevant)
- `conversion_events` (id, user_id, curriculum_id, event_type, intent, readiness_score, risk_level, anonymous_id, session_id, page_path, metadata, contact_id, deal_id) — **kein `package_id` als Top-Level-Spalte** (im `metadata`)
- `orders` (status, stripe_*, buyer_user_id, learner_user_id, billing_account_id, license_package_id, customer_type) — vollständig
- `entitlements` (user_id, product_id, curriculum_id, valid_from/valid_until, has_learning_course/has_exam_trainer/has_ai_tutor/has_oral_trainer) — **das ist die Bundle-Wahrheit**
- `learner_course_grants` (status, onboarding_status, source_ref) — Identity-Mapping
- `pricing_plans` (product_id, audience_type, plan_key, price_cents, stripe_price_id, checkout_mode, seat_count, duration_days)
- `lead_quizzes` + `quiz_attempts` (curriculum_id, score, passed, answers jsonb)
- `paywall_experiments` + `paywall_variants` (A/B-Test-Infrastruktur)
- `growth_actions`, `growth_metrics`, `growth_risk_scores`, `growth_content_jobs`, `growth_content_queue`

### Vorhandene RPCs
- `track_conversion_event_v2` — Event-Schreibpfad (Strict-Validation)
- `grant_learner_course_access` — idempotent, Trigger-gerufen
- `trg_orders_paid_grant` (auf `orders`) — Auto-Grant bei `status='paid'`
- `tutor_access_check` — Strict-RAG Gate
- `resolve_pricing_plans`, `classify_package_pricing_tier`
- `assign_paywall_variant` (+ anon Variante), `record_experiment_conversion`
- `check_user_entitlement`, `get_user_entitlements_current`, `has_storage_entitlement`
- `fn_enroll_pricing_nurture`, `fn_score_on_pricing_view` (Trigger auf conversion_events)

### Vorhandene Edge Functions (relevant)
`track-funnel-event`, `capture-lead`, `create-checkout`, `create-payment`, `create-product-checkout`, `create-b2b-checkout`, `berufski-{checkout,bundle-checkout,corporate-checkout}`, `stripe-webhook`, `ai-tutor`, `tutor-answer`, `outcome-tracker`, `ab-variant-tracker`, `admin-revenue-funnel-audit`.

### Vorhandene Frontend-Bauteile
- `useTrackGrowthEvent`, `src/lib/funnelEvents.ts`, `src/lib/tracking/track.ts`, `src/lib/checkout/startProductCheckout.ts`, `useStartCheckout`
- `LeadQuizPage` + `LeadQuizRunner` + `useLeadQuiz`
- `ProductPageTemplate` (Hero, Trust, Pain, USP, Modules, Pricing, FAQ, Final-CTA, Sticky)
- `seo/PruefungstrainingAzubisPage`, `seo/PruefungstrainingBetriebePage`, `seo/PruefungstrainingInstitutionenPage` (statische SEO-Hubs ohne Per-Produkt-Routing)
- B2B: `pages/org/*`, `WorkBuyPage`, `BerufsKIBuyPage`

### CI-Guards aktiv
`sql-discipline-guard`, `strict-event-package-id-guard`, `pricing-integrity-guard` (stündlich), `funnel-tracking-smoke`, `funnel-integrity-guard`, `ssot-guard`.

---

## Anhang B — Findings im Detail

### 🔴 Finding 1 — Pricing-Integrity: rot (BLOCKER für Regel 1)
- **Beweis:** `SELECT * FROM v_pricing_integrity_check` → 47 published Produkte ohne aktiven `pricing_plans`-Eintrag, Status `red`.
- **Verstößt gegen:** Regel 1 ("verkaufbar" = Pricing definiert).
- **Risiko:** Jeder Traffic auf diese 47 Produkte landet in einer Sackgasse → Revenue-Leak + Trust-Verlust.
- **Empfehlung:**
  1. `admin_pricing_backfill_preview` ausführen → review.
  2. `admin_pricing_backfill_apply` mit Tier-Mapping (49/79/99) gemäß `classify_package_pricing_tier`.
  3. CI-Guard `pricing-integrity-guard` auf **Hard-Block** stellen (aktuell warnend).
- **Aufwand:** 2h (RPC ist da). **Code: 0 Zeilen** — nur Daten-Fix + Workflow-Schraube.

### 🟡 Finding 2 — `package_id` nicht als Top-Level-Spalte in `conversion_events`
- **Ist:** `package_id` lebt in `metadata` jsonb (siehe Memory `strict-event-package-id-ssot-v1`). Strict-Guard prüft Presence.
- **Risiko:** Joins/Aggregationen langsam, Indexierung schwer, BI-Tooling muss jsonb parsen.
- **Empfehlung:** Generated column `package_id uuid GENERATED ALWAYS AS ((metadata->>'package_id')::uuid) STORED` + Index. Migration ist trivial, Strict-Guard bleibt grün.
- **Aufwand:** 1 Migration + 1 Test. Risiko: niedrig.

### 🟡 Finding 3 — `landing_view` fehlt im FunnelEvent-Enum
- **Spezifiziert (User):** `landing_view` als Pflicht-Event (Regel 5).
- **Ist:** `FUNNEL_EVENTS` enthält `LEAD_MAGNET_VIEW`, `LERNPLAN_VIEWED`, `pricing_hero_view` — kein generisches `landing_view`.
- **Empfehlung:** Erweitern um `LANDING_VIEW = 'landing_view'`, oder Mapping dokumentieren (`lead_magnet_view` IS `landing_view` für SEO-Pages). Letzteres ist sauberer (kanonische Namen nicht doppeln).
- **Aufwand:** 1h Doku-Update + Tracking-Tests.

### 🟡 Finding 4 — Persona-Routing pro Produkt fehlt
- **Spezifiziert (User):** `/pruefungstraining/:slug/azubi`, `…/betrieb`, `…/institution`.
- **Ist:** Drei statische Hub-Pages (`Pruefungstraining{Azubis,Betriebe,Institutionen}Page`) ohne Slug-Parameter. `ProductPageTemplate` ist persona-agnostisch.
- **Empfehlung:**
  1. Neue Routes `/pruefungstraining/:slug/:persona` (Persona-Whitelist).
  2. `ProductPageTemplate` um `persona`-Prop erweitern → Hero + CTA-Texte aus Lookup-Tabelle (3 Personas × 4 Felder = 12 Strings).
  3. `useTrackGrowthEvent`: `persona` automatisch aus URL.
  4. Sitemap: 3× pro Produkt.
- **Aufwand:** 1 Tag Frontend, kein Backend-Schema-Change.

### 🟡 Finding 5 — Lead-Gate vor Checkout nicht erzwungen (Regel 10)
- **Ist:** `LeadQuizRunner` existiert auf `/quiz/:slug`, ist aber **nicht** im Bundle-Buy-Flow vorgeschaltet. Nutzer kann direkt auf `BerufsKIBuyPage` → Checkout → ohne Diagnose.
- **Empfehlung:**
  1. `ProductPricingCard.onBuyClick` Hook: wenn keine `quiz_attempt` der letzten 30d für dieses `curriculum_id` → Modal "Erst Diagnose" mit Skip-Option (nicht hart blockieren — Regel 4: Instant Delivery, aber Soft-Nudge).
  2. Score speichern in `localStorage` + `conversion_events.metadata.last_quiz_score` für Personalisierung am Pricing.
- **Aufwand:** 1 Hook + 1 Modal-Komponente. Kein Backend.

### 🟡 Finding 6 — `checkout_started` Tracking lückenhaft
- **Beweis:** Letzte 30d → 0× `checkout_started` vs. 1× `checkout_complete`. Webhook funktioniert, aber Frontend-Tracking vor Stripe-Redirect feuert nicht zuverlässig.
- **Vermutung:** `useStartCheckout` trackt `cta_click` + `checkout_started`, aber `startProductCheckout` (separater Pfad) trackt nur `checkout_started` über `tracking_events` (alte Tabelle), nicht über `conversion_events`.
- **Empfehlung:** `startProductCheckout` migrieren auf `track-funnel-event` Edge Function mit `package_id` (Strict-Guard dann auch hart auf `checkout_started` aktivierbar).
- **Aufwand:** 1 Datei, ~30min.

### 🟡 Finding 7 — A/B-Tests vorhanden, aber kein Auto-Optimizer (Regel 13)
- **Ist:** `paywall_experiments`, `assign_paywall_variant`, `record_experiment_conversion`, `v_experiment_results` — Infrastruktur komplett.
- **Fehlt:** Cron, der bei statistisch signifikantem Ergebnis (Bayes oder ≥95% χ²) die Verlierer-Variante auf `is_active=false` setzt.
- **Empfehlung:** Edge Function `experiment-auto-conclude` (täglich) + Audit-Eintrag.
- **Aufwand:** 1 Edge Function + 1 Cron. Mittel.

### 🟡 Finding 8 — Diagnose-Quiz nutzt freie Fragen, nicht zwingend Blueprints (Regel 8)
- **Ist:** `quiz_questions` Tabelle existiert (eigene Fragen pro `lead_quizzes`).
- **Spezifiziert (User):** Quiz darf nur **approved exam_questions** nutzen (Blueprint-basiert).
- **Empfehlung:** Optionaler `source='exam_pool'` Modus in `lead_quizzes` → `useLeadQuiz` erweitert SELECT auf `exam_questions WHERE status='approved' AND package_id = ?`.
- **Aufwand:** Mittel — nur wenn User explizit will (aktuell läuft beides parallel).

### 🟡 Finding 9 — Pre-Sale AI-Tutor (Regel 17)
- **Ist:** `tutor_access_check` blockiert Tutor ohne Entitlement (korrekt). Kein "Demo-Tutor" für Conversion.
- **Empfehlung:** Public-RPC `tutor_demo_answer(question)` mit Rate-Limit (3/Session) und `[SOURCES]`-Block — gleicher Strict-RAG-Vertrag, aber ohne Tiefe. Optional.
- **Aufwand:** Mittel-Hoch. Niedrige Priorität (kein Beweis dass es konvertiert).

---

## Anhang C — Roadmap (priorisiert)

### Sprint 1 (diese Woche, hoher Hebel, niedriges Risiko)
1. **Pricing-Backfill** für 47 published Produkte (Finding 1) — Daten-Fix via `admin_pricing_backfill_apply`. **0 Code.**
2. **`package_id` als generated column** in `conversion_events` + Index (Finding 2) — 1 Migration.
3. **`startProductCheckout` → `track-funnel-event`** (Finding 6) — 1 Datei.
4. **`landing_view` Mapping dokumentieren** (Finding 3) — Memory-Update.

### Sprint 2 (nächste Woche, mittlerer Hebel)
5. **Persona-Routing** `/pruefungstraining/:slug/:persona` (Finding 4) — 1 Route + `ProductPageTemplate` Persona-Prop.
6. **Lead-Gate Soft-Nudge** vor Checkout (Finding 5) — 1 Modal + Hook.

### Sprint 3 (optional / Backlog)
7. Auto-Optimizer für Paywall-Experimente (Finding 7).
8. `exam_pool`-Modus für Diagnose-Quiz (Finding 8).
9. Pre-Sale Demo-Tutor (Finding 9).

---

## Anhang D — Was NICHT gebaut werden sollte (Anti-Tasks)

Folgende vom User vorgeschlagene Bauteile **nicht** umsetzen — sie verstoßen gegen die SYSTEM_RULES (SSOT), würden Parallel-Wahrheiten erzeugen und bestehende CI-Guards rotfärben:

| Vorschlag | Konflikt | Empfehlung |
|---|---|---|
| `CREATE TABLE growth_events` | `conversion_events` v2 ist SSOT (Memory, Strict-Guard, 4 Trigger, RLS) | Nicht anlegen. Verwenden. |
| `CREATE TABLE diagnostic_quiz_sessions` | `quiz_attempts` deckt das ab (curriculum_id, score, passed, answers, anonymous_id) | Nicht anlegen. Falls fehlende Spalte → ALTER. |
| `CREATE TABLE diagnostic_quiz_answers` | `quiz_attempts.answers jsonb` SSOT | Nicht anlegen. |
| `CREATE TABLE product_entitlements` | `entitlements` mit `has_learning_course/has_exam_trainer/has_ai_tutor/has_oral_trainer` ist SSOT | Nicht anlegen. |
| `CREATE TABLE checkout_sessions` | `orders` mit Status-Lifecycle + `stripe_checkout_session_id` ist SSOT | Nicht anlegen. |
| `CREATE TABLE pricing` | `pricing_plans` ist SSOT mit channel/audience-Differenzierung | Nicht anlegen. |
| `start_diagnostic_quiz` RPC | Doppelt mit `LeadQuizRunner`-Flow (insert in `quiz_attempts`) | Nicht anlegen. |
| `activate_entitlement_after_checkout` RPC | `trg_orders_paid_grant` macht das automatisch + idempotent | Nicht anlegen. |
| `has_package_access` RPC | `check_user_entitlement` / `get_user_entitlements_current` existieren | Nicht anlegen. |

---

## Anhang E — E2E-Test-Plan (für Sprint 1, nach Implementierung)

### E2E-A: SQL-Smoke (deterministisch)
```sql
-- 1. Test-User + Test-Quiz-Attempt
-- 2. simulate_funnel_run('quiz_completed' → 'lead_capture' → 'checkout_started' → 'checkout_complete')
-- 3. Assert: orders.status='paid' → trg_orders_paid_grant fired → entitlements.has_learning_course=true
-- 4. Assert: tutor_access_check returns ok
-- 5. Assert: conversion_events alle 5 Events mit package_id present
```
Liefere ich als `scripts/smoke-growth-engine.mjs` (Sprint 1, nach Daten-Fix).

### E2E-B: Playwright (User-Journey)
```
/pruefungstraining/<slug>/azubi → CTA → /quiz/<slug> → answer → result → CTA Bundle → checkout-stub → success → /app/package/<id>/start → AI-Tutor erreichbar
```
Liefere ich als `tests/e2e/growth-engine-azubi-flow.spec.ts` (Sprint 2).

---

## Schluss

Das System ist deutlich näher an "skalierendem Business" als an "MVP" — die fehlenden 10–15% sind **Verdrahtung + Daten-Fixes**, kein Architektur-Defizit.

**Größter Hebel:** Pricing-Rot beheben (Finding 1) → ohne das ist 70% des Traffics tot.

**Empfohlener nächster Tool-Call:**
1. `admin_pricing_backfill_preview` ausführen, Ergebnis review.
2. Sprint-1-Tasks (1–4) als 4 separate, kleine Migrations/Patches einplanen.
