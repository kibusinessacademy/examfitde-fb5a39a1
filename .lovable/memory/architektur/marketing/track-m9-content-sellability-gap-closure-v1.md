---
name: Track M9 Content Sellability Gap Closure v1
description: Track-aware sellability SSOT v_package_sellability_v1 + admin RPCs für Per-Track-Summary, Per-Package-Dispatch und Backfill. EXAM_FIRST gilt ohne Lessons als sellable (nur ≥50 approved questions + Pricing). Echte Content-Gaps werden in package_scaffold_learning_course / package_generate_learning_content / package_repair_failed_lessons gemappt.
type: feature
---

## Komponenten

- **v_package_sellability_v1** (service_role only): klassifiziert jedes published Paket nach gap_class:
  - `pricing_missing` (M8-Domain)
  - `questions_missing` (<50 approved → Content-Gap-Top-Up)
  - `modules_missing` / `lessons_missing` / `lessons_not_ready` (M9-Domain, nur AUSBILDUNG_VOLL+EXAM_FIRST_PLUS)
  - `sellable`
- **admin_get_content_sellability_summary** — Per-Track-KPIs (admin only)
- **admin_get_content_sellability_gaps(p_gap_class, p_limit)** — Detail-Liste
- **admin_content_sellability_dispatch(p_package_id, p_dry_run)** — mapt gap_class auf Job-Type, blockt bei active job, Audit `m9_content_sellability_dispatch`
- **admin_content_sellability_backfill(p_limit, p_dry_run)** — WIP-capped Batch, Audit `m9_content_sellability_backfill`
- **TrackM9StatusCard** im HealCockpit mit Per-Track-Tabelle + Dry-Run/Live-Backfill-Buttons

## Track-aware Logik

| Track | Required für sellable |
|---|---|
| EXAM_FIRST | approved_questions ≥ 50 + ACTIVATED pricing |
| EXAM_FIRST_PLUS | + modules>0, lessons>0, lessons_ready=lessons |
| AUSBILDUNG_VOLL / STUDIUM | + modules>0, lessons>0, lessons_ready=lessons |

## Baseline 2026-05-16 (nach Migration)

- 190 published total
- 173 sellable (91%) — gegenüber 59 in alter view (track-blind)
- 17 echte Content-Gaps: 5 modules_missing, 12 lessons_not_ready (alle AUSBILDUNG_VOLL/EXAM_FIRST_PLUS)
- EXAM_FIRST 167/167 sellable (alle ≥50 approved questions, ACTIVATED pricing)

## Scope-Grenzen

- KEIN Pricing-Repair (M8), KEIN Question-Backfill (Content-Gap-Top-Up), KEIN SEO-Repair
- Reine Content-Pipeline: scaffold → generate → repair_failed
