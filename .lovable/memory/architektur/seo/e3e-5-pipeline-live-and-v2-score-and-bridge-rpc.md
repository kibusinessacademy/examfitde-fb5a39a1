---
name: E3e.5 Pipeline Live + v2 Score + Bridge-RPC
description: 2 SEO-Blog-Edges deployed, seo-pool-runner routet per job_type, Cornerstone-Score v2 rebalanced (5 Cornerstones), Bridge-Aktivierungs-RPC für Cornerstones
type: feature
---

## E3e.5 — Pipeline live (2026-05-25)

**Edges deployed:**
- `seo-blog-hero-generate` — Lovable AI Gateway `google/gemini-2.5-flash-image` → public-assets/blog-heroes/<id>.<ext>, setzt blog_articles.hero_image_url+hero_image_alt, self-finalize Job.
- `seo-blog-anchor-section-generate` — Pure-SQL Sibling-Pick (same source_curriculum_id, fallback source_package_id), schreibt internal_links_json [{slug,title,url,reason}] 4-6 Stück.
- `seo-pool-runner` patched: JOB_TYPE_TO_EDGE Map routet seo_intent_page_generate / seo_blog_hero_generate / seo_blog_anchor_section_generate. Unknown job_type → klarer Fehler im result.

Audit-Compliance: fn_emit_audit Parameter angepasst (_payload/_trigger_source, nicht _metadata/_source). Required_keys (blog_article_id, blog_slug, hero_image_url/links_added, curriculum_id, duration_ms, model) komplett.

## E3e.5b — Cornerstone-Score v2 (rebalanced)

v1 → v2 Weights:
- depth   0.25 → **0.29**
- quality 0.15 → **0.20**
- faq     0.15 (unchanged)
- hero    0.15 (unchanged — pipeline-filled)
- anchor  0.15 (unchanged — pipeline-filled)
- winner  0.05 → **0.02**
- views   0.05 → **0.02**
- perf    0.05 → **0.02**

Rationale: hero+anchor sind ab E3e.5 aktiv pipeline-gefüllt, winner/views/perf bleiben strukturell unmessbar (external metrics).

**Impact 2026-05-25**: 0/256 ≥0.60 → **5/256 ≥0.60**, Top-Score 0.5954 → 0.6727.
Audit: `cornerstone_blog_score_v2_deployed` registriert + emitted.

## E3e.5c — Cornerstone-Bridge-Aktivierungs-RPC

`admin_activate_cornerstone_bridge_suggestions(p_min_score=0.60, p_dry_run=true, p_reason=NULL)`:
- Reuse von `seo_internal_link_suggestions` (kein neuer Table — BRIDGE_DONT_FORK).
- Filtert suggested rows mit source_url='/blog/<cornerstone-slug>' und link_type ∈ {blog_to_pillar, blog_to_exam_package}.
- Dry-run default, Reason ≥5 chars Pflicht für live.
- Audit `cornerstone_bridge_activated` mit cornerstone_blogs/candidates/activated/skipped/correlation_id.
- has_role admin, REVOKE PUBLIC.

Baseline-Backlog 2026-05-25: 76 suggested (51 blog_to_pillar + 25 blog_to_exam_package). Mindestens 1 Cornerstone-Slug (`crashkurs-betriebswirt-ihk-...`) hat suggested blog_to_pillar → `/betriebswirt-ihk-pruefung` zum Aktivieren bereit.

## Offen
- Lessons-Repair Welle 2 (87 LESSONS_NOT_READY) — deferred.
- Persona↔Cert-Pillar A3 (memory-eintrag suggerierte): bereits live (4577 active inkl. 692 A2-Reciprocal). Kein Backlog mehr in dieser Richtung.
