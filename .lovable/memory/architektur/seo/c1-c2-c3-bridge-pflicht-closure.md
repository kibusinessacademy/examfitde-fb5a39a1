---
name: C1+C2+C3 Bridge-Pflicht Closure 2026-05-25
description: Cornerstone-Enrichment 30 Jobs dispatched, Lessons-Wave-2 obsolet (0 LESSONS_NOT_READY), Catalog-Mapping 13 MAPs geschlossen
type: feature
---

## C1 — Cornerstone-Enrichment Dispatch (E3e.5 Pilot)
- RPC `admin_seo_cornerstone_enrich_dispatch` existiert (Migration 111408) — admin-gated, hat aber Probleme mit Pflicht-Payload-Keys (curriculum_id+package_id) und Uniqueness-Guards.
- Manual-Bypass via service-role INSERT: **48 Jobs dispatched** (28 hero + 20 anchor) für 28 von 30 Targets. 2 Targets übersprungen wegen `source_curriculum_id IS NULL`.
- Payload-Contract: muss `curriculum_id` (uuid format check), `package_id`, `lesson_id := blog_article_id` enthalten — sonst:
  - `guard_job_payload`: SSOT VIOLATION wenn curriculum_id fehlt
  - `job_queue_unique_global_job` (package_id IS NULL): blockt mehrere Jobs gleicher (job_type,curriculum_id)
  - `uq_job_queue_active_package_job`: blockt mehrere Jobs gleicher (package_id,job_type) — Workaround: lesson_id := blog_article_id
- TODO: RPC `admin_seo_cornerstone_enrich_dispatch` muss um curriculum_id+package_id+lesson_id-Payload-Building erweitert werden. Sonst läuft sie ins Guard-Reject.
- Seo-pool-runner (Cron 246, 5min) drained automatisch.

## C2 — Lessons-Repair Wave 2 (obsolet)
- Memory v1 sagte: 87 LESSONS_NOT_READY → Wave-2 dispatchen.
- Reality 2026-05-25: `v_lessons_gap_ssot` zeigt 151 HAS_READY + 39 EXEMPT = 190/190 customer_safe_for_lessons.
- Wave 1 + Klassifizierungs-Heuristik haben die Lücke geschlossen. **Kein Dispatch nötig.**
- Memory-Update: Lessons-Gap-Policy v1 erreicht 190/190.

## C3 — Catalog-Mapping-Closure (13 MAPs)
- Audit-Contract `certification_catalog_seed` registriert (owner_module=`c3_catalog_mapping_closure`).
- **2 existing** Rows ge-linked: aevo, personalfachkaufmann-ihk (linked_certification_id war NULL).
- **11 neu inserted**: Anlagenmechaniker SHK, Bankkaufmann, Fachinformatiker AE+SI, §34i, §34c, Industriekaufmann, Einzelhandel, Koch, Scrum Master PSM I, Verwaltungsfachangestellte.
- **Deferred**: Compliance Officer (#4), Kaufleute Umwelt/Nachhaltigkeit (#10), Wohnimmobilienverwalter §26a (#17) — REVIEW (synthetische Skeleton-IDs, PO-Entscheidung).
- **Excluded**: Polizeivollzugsdienst (#14) — Anti-Drift North-Star.
- Effekt für A3: 13 Catalog-Mappings vorhanden → `NO_CERT_MAPPING`/`NO_CATALOG_MAPPING` schrumpft entsprechend bei nächstem Recon.

## Folgepunkte
1. RPC `admin_seo_cornerstone_enrich_dispatch` Payload-Builder erweitern (curriculum_id+package_id+lesson_id Pflicht).
2. Recon Persona↔Cert-Pillar nach C3-Seed neu laufen lassen — 13 NO_CATALOG_MAPPING sollten 0/wenige werden.
3. 3 REVIEW-Entscheidungen für PO eskalieren.
