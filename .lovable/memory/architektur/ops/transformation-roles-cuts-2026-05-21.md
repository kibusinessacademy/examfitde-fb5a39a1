---
name: Transformation-Roles 4 Cuts (2026-05-21)
description: Vier sequenzielle systemische Cuts — Canonical Package Guard, system_intents Phase 2b, Intervention Outcome Loop, E3e Pillar↔Contextual Bridging.
type: feature
---

## Übersicht
Vier Phasen in einer Session ausgeführt, jede als isolierte Migration mit Audit-Contract + Baseline-Audit.

### Cut 1 — P6 Cut 6a Canonical Package Consolidation Guard
- Partial UNIQUE indexes: `uq_course_packages_package_key_published`, `uq_course_packages_curriculum_published` (forward-only — Baseline 0 Dupes auf 190 published).
- View `v_canonical_package_drift` mit 4 drift_kinds: DUPLICATE_PACKAGE_KEY / DUPLICATE_CURRICULUM_PUBLISHED / DUPLICATE_SLUG_PUBLISHED / NULL_PACKAGE_KEY_PUBLISHED.
- RPC `admin_get_canonical_package_drift` (has_role gate).
- Audit: `canonical_package_drift_check` (baseline_clean=true, 0 rows).

### Cut 2 — P7 system_intents Phase 2b
- INTENT_ROUTES erweitert: `production_guardian_tick` → production-guardian, `exam_pool_loop_breaker_tick` → exam-pool-loop-breaker.
- Cron-Jobs `production-guardian-5min` + `exam-pool-loop-breaker-5min` umgestellt von direkter `net.http_post` auf `cron_record_tick_intent(...)`.
- Schließt die letzten direkten Cron→Worker-Pfade. Eliminiert HTTP-Key in Cron-Definitionen für diese beiden Pipelines.
- Audit: `system_intent_phase_2b_cutover`.

### Cut 3 — Intervention Outcome Loop (Learning Intelligence)
- Tabelle `recommendation_outcomes` mit GENERATED `mastery_delta`. RLS: own + admin select; Writes nur via RPC.
- RPC `learner_record_recommendation_outcome` validiert ownership, schließt Recommendation bei terminalen Outcomes (mastered/dismissed/irrelevant).
- View `v_recommendation_effectiveness` aggregiert positive/negative/feedback_rate/avg_mastery_delta pro (recommendation_type, reason_code).
- RPC `admin_get_recommendation_effectiveness` für Cockpit.
- Audit: `recommendation_outcome_recorded`.

### Cut 4 — E3e Pillar↔Contextual Bridging
- View `v_pillar_contextual_bridge_candidates` joint blog_articles.source_curriculum_id → curricula.certification_id → certification_seo_pages. Baseline: **137 candidates, avg score 30.4, 0 ≥50** (Tuning erforderlich oder Score-Formel verschärfen).
- RPC `admin_e3e_suggest_pillar_contextual_bridges(cap≤100, min_score, dry_run=true)` materialisiert top-N in `seo_internal_link_suggestions` als `link_type='pillar_contextual_bridge'` mit dedup-guard.
- Schließt die in E3d.2b nachgewiesene Trennung (contextual-Blog-Graph ⊥ Pillar/Spoke-Layer, 124 unreachable).
- Audit: `e3e_pillar_contextual_bridge_run`.

## Linter-Hinweis
Pre-existing 2282 Issues → +4 nach allen Migrationen (3 neue SECURITY DEFINER Views + 1 RLS-Tabelle ohne Policy für admin-write — alle gated per RPC + service_role). Nicht neu eingeführte Schwachstelle.

## Offene Folge-Cuts
- Cockpit-UI für alle 4 neuen RPCs (analog GscReconciliationCard).
- E3e Score-Tuning (winners + competency_id-Anchors → realistic min_score 30 statt 50).
- Effectiveness-Cron der `v_recommendation_effectiveness` (auto-policy Sprint 2).
