# ExamFit Launch Readiness

Single source of truth for the question: **„Können wir ExamFit heute verkaufen?“**

## Aktueller Status (Snapshot)

| Bereich | Status | Quelle |
|---|---|---|
| Empty published courses | 🔴 34 | `admin_get_empty_published_courses()` |
| Sellable courses (verkaufbar inkl. Stripe-Preis) | 🔴 0 | `v_public_sellable_courses` (Filter `is_sellable=true AND has_stripe_price=true`) |
| Active priced products (Pool) | 🟡 50 (active+price), davon 3 mit `visibility='public'`, alle 3 ohne aktiven Preis | `products` × `product_prices` |
| Pipeline L2 enforce | 🟡 warn-only | `admin_get_l2_enforce_readiness()` |
| Approved exam questions / curricula | 🟢 430 curricula, 203k questions | `exam_questions` |
| Admin Cockpit | 🟢 live | `/admin/ops/publish-blockers` |

> **Bottom line:** Soft-Launch nicht möglich, solange keine `(course → public product → active priced stripe_price)` Kette geschlossen ist. Public-Launch zusätzlich erst nach Empty=0.

## Live-Ampel

Backend-SSOT: `admin_get_launch_readiness_dashboard()`
UI: `/admin/ops/publish-blockers` → Card **„Launch Readiness“** (oben).

```sql
-- Schnelltest
select public.admin_get_launch_readiness_dashboard();
```

## Verkaufbarkeitsregel (SSOT)

`public.v_public_sellable_courses` setzt `is_sellable=true` nur wenn:

- `courses.status='published'`
- mind. 1 Modul, mind. 1 Lesson, mind. 1 Lesson `ready`
- es gibt ein `products` mit `status='active' AND visibility='public' AND curriculum_id=courses.curriculum_id`
- mind. ein `product_prices.active=true` existiert
- `product.slug` vorhanden (Public URL)

Frontend-Shop / Produktseiten dürfen **ausschließlich** `public_sellable_courses()` lesen.

## Soft Launch Checklist

- [ ] mindestens 1 Kurs in `v_public_sellable_courses` mit `is_sellable=true AND has_stripe_price=true`
- [ ] purchase → grant Smoke (`tests/e2e/purchase-grant-access.spec.ts`) grün
- [ ] progress persistence E2E grün
- [ ] keine stuck processing jobs (`admin_get_launch_queue_health`)
- [ ] A11y/Contrast Guards grün
- [ ] Stripe Test-Mode E2E grün

## Public Launch Checklist (zusätzlich)

- [ ] Empty published courses = 0 (`empty-courses-cleanup-runner.mjs`)
- [ ] L2 `safe_to_enforce=true`
- [ ] `bypassed_24h = 0` oder dokumentiert
- [ ] `pricing_ready ≥ sellable_courses`
- [ ] SEO Sellable Pages Guard grün
- [ ] Trainer Availability ≥ 1

## Tooling

| Tool | Pfad |
|---|---|
| Cleanup Runner | `node scripts/guards/empty-courses-cleanup-runner.mjs --dry-run` |
| SEO Guard | `node scripts/guards/seo-sellable-pages-guard.mjs` |
| Backfill Runner | `node scripts/guards/empty-courses-backfill-run.mjs` |
| L1 Publish-Guard Test | `node scripts/guards/course-publish-guard-test.mjs` |
| L2 Publish-Guard Test | `node scripts/guards/course-publish-guard-l2-test.mjs` |
| Purchase-Grant E2E | `bunx playwright test tests/e2e/purchase-grant-access.spec.ts` |

## Required CI Checks (vor Public Launch)

- contrast-token-audit
- a11y-learner-regression
- a11y-smoke-routes
- status-revert-guard
- course-publish-guard (L1)
- course-publish-guard-l2
- learner-course-readiness
- qa-pins-validation
- learner-progress-persistence
- launch-readiness (SEO sellable pages)

## Rollback Plan

1. `admin_demote_empty_course(_course_id, 'rollback')` für problematische Kurse.
2. Stripe-Preis deaktivieren → fällt automatisch aus `v_public_sellable_courses`.
3. Wenn nötig `app.publish_guard_level2 = 'enforce'` zurück auf `warn`.
4. `auto_heal_log` filtern auf `course_publish_readiness_*` für Forensik.

## Admin URLs

- `/admin/ops/publish-blockers` — Cockpit (Launch Ampel + Pipeline + L2 + Blocker)
- `/admin/cockpit` — Übersicht
- `/admin/queue` — Queue Health

## Antworten an PM

- **Darf ich soft launchen?** Nein — kein Kurs erfüllt aktuell `(public product + active stripe price)`. Sobald ≥1 Kurs aktiv geprict ist, geht Soft-Launch.
- **Darf ich public launchen?** Nein — 34 empty published courses, L2 nicht enforced.
- **Top 3 Schritte:**
  1. Stripe-Preise + `product_prices.active=true` für 3 public products setzen.
  2. `empty-courses-cleanup-runner.mjs --demote-duplicates --demote-no-curriculum` ausführen → Empty < 10.
  3. `admin_get_launch_readiness_dashboard()` täglich beobachten, bis `can_public_launch=true`.
