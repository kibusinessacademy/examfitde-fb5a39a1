---
name: Pre-Customer Reality Daily QA v1
description: Tägliche Playwright-Pipeline misst Pre-Login-Funnel (Visitor→Beruf→Kurs→Preis→CTA→Checkout) mit 8 gewichteten Journeys + TIME_TO_COURSE KPI.
type: feature
---

# Pre-Customer Reality Daily QA v1

**Cut:** 2026-05-30
**Prinzip:** Pre-Login-Funnel messen — vor Learner-Journey. Realität, keine Architektur.

## Pipeline

- **Workflow:** `.github/workflows/pre-customer-reality-daily.yml`
  - Cron `37 6 * * *` (täglich 06:37 UTC, 20min nach learner-reality) + `workflow_dispatch`
  - Optional `base_url` Input überschreibt `REALITY_BASE_URL`
- **Project:** Playwright `pre-customer-reality` (Chromium)
- **Tests:** `tests/customer-reality/precustomer/01-…08-…spec.ts`
- **Aggregator:** `scripts/pre-customer-reality-aggregate.mjs`
- **Artifacts:** `reality-results/` (`pre-customer-reality-results.json`, `-report.md`, `pre-customer-metrics.json`, findings)

## Journeys + Scoring

| Journey | Gewicht | Spec |
|---|---|---|
| P01 Homepage | 10 | 01-homepage |
| P02 Beruf finden | 15 | 02-find-beruf |
| P03 Kursseite öffnen (+TTC) | 15 | 03-open-course |
| P04 Preis verstehen | 15 | 04-pricing |
| P05 CTA klicken | 10 | 05-cta-click |
| P06 Checkout-Surface | 15 | 06-checkout-surface |
| P07 Cross-Sell | 10 | 07-cross-sell |
| P08 BerufOS-Hub | 10 | 08-berufos-hub |

**Gate:**
- `RELEASE` nur wenn `score ≥ 85` UND keine P0/P1 UND `time_to_course_ms` gemessen
- `REVIEW` bei P1, `70 ≤ score < 85` oder fehlendem TTC
- `BLOCK` bei P0 ODER `score < 70`

## KPI: TIME_TO_COURSE

- **Start:** Homepage `/`
- **Ende:** erste Kursseite (`/berufe/<slug>` | `/kurs/...` | `/produkt/...`) geladen
- **Ziel:** `< 60s`
- Gemessen in `P03_open_course` via `navigateVisitorToCourse(page)` → `reality-results/pre-customer-metrics.json`
- Aggregator hebt `time_to_course_ms` + `time_to_course_ok` in Result-JSON und Report

## Non-destruktiv

- Kein echter Stripe-Submit. P06 prüft nur ob CTA auf `/auth|/checkout|stripe.com|/onboarding` führt.
- Kein Login nötig — alle 8 Journeys laufen als Visitor.
- `CHECKOUT_TEST_MODE=true` Env-Default.

## Bewusst NICHT gebaut

- Keine neuen DB-Tabellen, Edge-Functions, Tracking-Schemas.
- Keine Refactors am Funnel.
- Kein echter Bezahlvorgang.

## Verbindung zu Learner-Reality v1

Reihenfolge täglich:
1. 06:17 UTC `learner-reality-daily` (Post-Login)
2. 06:37 UTC `pre-customer-reality-daily` (Pre-Login)

Beide Reports unabhängig — getrennte Status, getrennte Gates. Findings nutzen geteilten `findings/`-Sink, Aggregatoren filtern via journey-pass IDs (`J*` vs `P*`).
