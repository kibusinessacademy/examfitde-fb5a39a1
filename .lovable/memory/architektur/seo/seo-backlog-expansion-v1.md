---
name: SEO Backlog Expansion v1
description: admin_seo_backlog_expand RPC — lifts publishable curricula ohne seo_content_priority_queue-Rows in selectable scope mit derived cluster_priority. Vorbereitung Pillar-Push.
type: feature
---

## RPC-Contract (FROZEN)

`public.admin_seo_backlog_expand(`
- `p_limit integer DEFAULT 25` — 1..100 (clamped)
- `p_dry_run boolean DEFAULT true`
- `p_min_package_priority integer DEFAULT 4` — Filter über `course_packages.priority`
- `p_curricula uuid[] DEFAULT NULL` — Optional Whitelist (Surgical Targeting)
- `p_default_cluster_prio integer DEFAULT 5` — Fallback wenn pkg_priority NULL
- `p_wave_tag text DEFAULT NULL` — Audit-Label
`)` → `jsonb { ok, dry_run, audit_id, selected_count, inserted_rows?, skipped_rows?, selected[] }`

Guard: `auth.uid()` + `has_role('admin')`. SECURITY DEFINER, search_path=public.

## Selektor

- Picks publishable curricula (course_packages.status='published', distinct on curriculum_id)
- NOT EXISTS in seo_content_priority_queue
- Filter: `pkg_priority >= p_min_package_priority`
- Rank: `pkg_priority DESC NULLS LAST, curriculum_title ASC`
- Limit: `p_limit`

## Insert-Shape pro Curriculum

4 Rows × `azubi`-Persona × `{pruefungsfragen, lernplan, typische_fehler, durchfallquote}`
- `competency_id` = first competency (learning_field.sort_order, competency.sort_order)
- `cluster_priority` = `LEAST(GREATEST(pkg_priority+1, 3), 7)`
- `semrush_volume=0, thin_content_risk='unknown', generation_status='planned', package_publish_eligible=true`
- `notes = 'seo_backlog_expand|audit=<uuid>[|wave_tag=<tag>]'`

Idempotent via UNIQUE(curriculum_id, competency_id, intent_key, persona_type).
Audit: `auto_heal_log action_type='seo_backlog_expand_attempt'` (dry_run/ok).

## Baseline 2026-05-16

- 21/190 publishable curricula im Queue (vor Expansion)
- 169 missing — alle haben ≥1 competency
- pkg_priority Verteilung: 0 high (≥7), 102 mid (4–6), 67 low (≤3)
- Default p_limit=25 picks 25/102 mid mit cluster_priority=6

## Use mit Pillar-Push

1. Dry-Run: `SELECT admin_seo_backlog_expand(p_limit:=25, p_dry_run:=true);`
2. Apply: `p_dry_run:=false, p_wave_tag:='backlog_2026_05_16'`
3. Selector v1 (`admin_select_next_seo_wave`) sieht die neuen Rows automatisch
4. `pillar_push` Strategie kann jetzt aus dem expandierten Pool ziehen

## Constraints

- Keine `umschueler`-Persona-Expansion (enum-contract pending).
- Kein Cron — bewusst manuelle Orchestrierung pro Welle.
- Nicht für bestehende Curricula gedacht (NOT EXISTS Filter). Score-Upgrade existierender Rows via separater RPC (TBD).
