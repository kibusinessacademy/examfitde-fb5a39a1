---
name: SEO Wave Selector v1
description: admin_select_next_seo_wave RPC-Contract + v_seo_wave_candidates / v_seo_inventory_utilization SSOT. Pflicht-Signaturen, Strategien, Beobachtungs-Gates.
type: feature
---

## RPC-Contract (FROZEN)

`public.admin_select_next_seo_wave(`
- `p_limit integer DEFAULT 6` — 1..20 (clamped)
- `p_strategy text DEFAULT 'balanced_curriculum'` — enum: `balanced_curriculum | pillar_push | high_intent_first | long_tail_expand | semrush_weighted`
- `p_max_per_curriculum integer DEFAULT 2` — 1..8 (clamped)
- `p_dry_run boolean DEFAULT true`
- `p_wave integer DEFAULT NULL` — **INTEGER, nicht text**. Narrative Labels wie `wave_5b` NIEMALS direkt einreichen → 22P02. Mapping: 1..N entspricht der Wellen-Nummer; Sub-Wellen (5a/5b) werden via Audit-Metadata getaggt, nicht via `p_wave`.

`)` → `jsonb { ok, dry_run, audit_id, selected[], enqueued[] }`

Guard: `auth.uid()` + `has_role('admin')`. service_role darf NICHT direkt rufen — Smoke nur via `SET LOCAL request.jwt.claims` mit Admin-UUID.

## SSOT-Views

- `v_seo_wave_candidates` — Ranking-Input. Felder: `wave_eligible, publish_eligible, exclusion_reason, thin_content_risk, pillar_progress_ratio, intent_priority, cluster_priority, semrush_volume, seo_score_projection, existing_spoke_count, active_job_exists, recent_failure_count_24h`.
- `v_seo_inventory_utilization` — Funnel-Endzustand: eligible / queued / active / published / blocked / exhausted.

## Strategien (Scoring)

| Strategy | Formel |
|---|---|
| balanced_curriculum | `seo_score_projection + (1-pillar_progress)*20` |
| pillar_push | `(1-pillar_progress)*100 + intent_priority` |
| high_intent_first | `intent_priority*20 + seo_score_projection*0.3` |
| long_tail_expand | `(semrush=0 ? 50 : 0) + cluster_priority*5` |
| semrush_weighted | `LEAST(semrush/50, 80) + intent_priority` |

## Beobachtungs-Gates pro Wave

| Gate | Ziel |
|---|---|
| spokes_completed | p_limit/p_limit |
| spokes_failed | 0 |
| QS-Score | ≥95 |
| inventory.eligible nach Wave | ≤ erwarteter Rest |
| pillar_progress_ratio Targets | dokumentieren |
| cron 246 (pool drain) | kein Backlog |
| cron 245 (pillar trigger) | feuert bei 8/8 |

## Wave 5b Baseline (2026-05-16)

- p_strategy=pillar_push, p_limit=6, p_max_per_curriculum=3, p_wave=5
- 6/6 enqueued, audit `6cc42ad6-1492-440a-b354-3d2593155511`
- Industriekaufmann 7/8→8/8 + FISI 8/8 (lernplan/typische_fehler/durchfallquote × 2 Curricula)

## Constraints

- Persona-Expansion NICHT via `umschueler` (enum-contract). Persona-Erweiterung erst nach Enum-Contract-Update.
- Multi-Row-INSERT in `job_queue` für `seo_intent_page_generate` bleibt verboten — Selektor ruft ausschließlich `admin_seo_wave_enqueue_one` pro Zeile.
- Backlog-Expansion: nur Skeleton-Curricula deren `course_packages.status='published'` → flippen automatisch via `trg_seo_queue_refresh_on_package_status`.
