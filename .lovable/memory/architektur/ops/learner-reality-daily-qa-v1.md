---
name: Learner Reality Daily QA v1
description: Tägliche Playwright-Pipeline misst End-to-End-Erfolg eines echten Lernenden über 10 gewichtete Journeys mit RELEASE/REVIEW/BLOCK-Gate.
type: feature
---

# Learner Reality Daily QA v1

**Cut:** 2026-05-30
**Prinzip:** Realität messen, keine Architektur bauen.

## Pipeline

- **Workflow:** `.github/workflows/learner-reality-daily.yml`
  - Cron `17 6 * * *` (täglich 06:17 UTC) + `workflow_dispatch`
  - Optional `base_url` Input überschreibt `REALITY_BASE_URL`
  - Concurrency `learner-reality-daily`, kein cancel-in-progress
- **Browser:** Playwright Project `learner-reality`, Chromium + iPhone-13 viewport (J11)
- **Tests:** `tests/customer-reality/learner/01-…10-…spec.ts` + `11-mobile-discovery.spec.ts`
- **Aggregator:** `scripts/learner-reality-aggregate.mjs`
- **Artifacts:** `reality-results/` (JSON, MD, findings, login-flag), `playwright-report/`, `test-results/`, retention 14d
- **Job-Summary:** Aggregator-MD wird in `$GITHUB_STEP_SUMMARY` gerendert

## Scoring

| Journey | Gewicht | Spec |
|---|---|---|
| J01 Discovery | 10 | 01-discovery |
| J02 Account (login/logout/gate) | 10 | 02-account |
| J03 Purchase / Access | 10 | 03-purchase-access |
| J04 Onboarding | 10 | 04-onboarding |
| J05 Learning (Kurs+Lesson) | 15 | 05-learning |
| J06 MiniCheck | 10 | 06-minicheck |
| J07 AI Tutor | 10 | 07-ai-tutor |
| J08 Written Exam | 10 | 08-written-exam |
| J09 Oral Exam | 10 | 09-oral-exam |
| J10 Return Journey | 5 | 10-return |
| J11 Mobile Discovery | — (P2-only) | 11-mobile-discovery |

**Gate:**
- `RELEASE` nur wenn `score ≥ 85` UND `login_validated=true` UND keine P0/P1
- `REVIEW` bei P1 oder `70 ≤ score < 85`
- `BLOCK` bei P0 ODER `score < 70` ODER fehlendem `learner-login-success.flag`

## Anti-False-Green-Regeln

1. **Pflicht-Login:** Jeder authentifizierte Test schreibt `reality-results/learner-login-success.flag`. Ohne Flag = automatisch `BLOCK`. Reine Public-Smokes können nie `RELEASE` erzeugen.
2. **Missing Creds = skip, not green:** `REALITY_LEARNER_EMAIL/_PASSWORD` fehlend → `test.skip()` mit expliziter Reason → journey bleibt `missing` → Score sinkt unter Gate.
3. **Auth-Pflicht für 7/10 Journeys:** J02/J04/J05/J06/J07/J08/J09/J10 erfordern echten Learner-Login.
4. **Non-destructive Checkout:** J03 verifiziert nur Auth-/Stripe-Surface (`stripe.com|/auth|/checkout`), bricht vor Payment ab. `CHECKOUT_TEST_MODE=true` als Env-Default.
5. **P0-Findings = harter Fail:** Aggregator-Exit 2 → Workflow rot.

## Pflicht-Secrets

- `REALITY_LEARNER_EMAIL`, `REALITY_LEARNER_PASSWORD` — bestehender Testaccount mit aktivem Grant
- optional: `REALITY_B2B_LEARNER_EMAIL/_PASSWORD`, `REALITY_BASE_URL` (sonst Preview)

## Findings-Format

`reality-results/findings/<ts>-<rand>.json` — Schema aus `tests/customer-reality/_helpers.ts::Finding`:
`{severity P0|P1|P2, kind, journey, route?, detail, fix?, ts}`.

## Bewusst NICHT gebaut

- Keine neue DB-Tabelle, kein neuer Edge-Function-Endpoint, kein Tracking-Schema.
- Keine Architektur-/Refactor-Arbeit am Produkt.
- Keine destruktiven Aktionen, kein echtes Payment, keine Stripe-Webhook-Simulation.

## Erweiterungen (offen, nicht jetzt)

- Slack-/Email-Versand des MD-Reports → über bestehende `heal-alert-notify` Edge-Function einhängen, sobald täglich grün stabil.
- Trend-Persistenz (Score über Zeit) → später als `reality_results_history.jsonl` Append-Only.
- Additional personas (B2B-Lerner, Recruiter, Owner) → eigene Score-Lane.
