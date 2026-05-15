---
name: LF-Repair Gate-Source-Drift Fix + Variant-Approval-Bridge v1
description: View-Fix der LF-Coverage-Gap-Klassifikation (blueprint_variants → exam_question_variants) plus Variant-Approval-Bridge für AWAITING_APPROVAL-Lernfelder
type: feature
---

# Kontext
Phase 2.4 Monitoring deckte 2026-05-15 auf, dass `v_exam_pool_lf_repair_gap_classification.usable_variant_count`
aus `blueprint_variants` (für alle Pakete leer) gelesen hat, während der Variant-Generator nach
`exam_question_variants` schreibt (global 255k review, 10k approved). Folge: jeder LF mit Material
wurde fälschlich als VARIANT_GAP klassifiziert; LF-Gap-Variant-Bridge enqueuete Fanout-Jobs die
vom Phantom-Guard 100 % gecancelt wurden.

# Schritt 1 — View-Fix (`v_exam_pool_lf_repair_gap_classification`)
- `usable_variant_count` jetzt = `count(*) FILTER (status='approved')` aus `exam_question_variants`
  joined über `course_packages.curriculum_id`.
- Neue Diagnose-Spalten am View-Ende: `review_variant_count`, `rejected_variant_count`,
  `total_variant_count`, `variant_pipeline_state` (`AWAITING_APPROVAL` | `NO_MATERIAL` | NULL).
- gap_class-Logik unverändert.
- **Spaltenreihenfolge**: CREATE OR REPLACE VIEW darf bestehende Spalten nicht umbenennen — neue
  Spalten zwingend am Ende anhängen.

# Schritt 2 — Variant-Approval-Bridge (LF_REPAIR_AWAITING_APPROVAL)
- **Cron 241** (`lf-gap-variant-bridge-15min`) deaktiviert (Audit `lf_gap_variant_bridge_paused`).
- Phantom-Filter `claim_pending_jobs_by_types` whitelisted neuen `_origin='variant_approval_bridge'`
  in beiden NOT-IN-Klauseln (origin + enqueue_source) plus meta.enqueue_source.
- RPC `admin_dispatch_variant_approval_bridge(p_package_id uuid)`:
  - Eligibility: mind. 1 LF mit `variant_pipeline_state='AWAITING_APPROVAL'`, review_variant_count>0.
  - Active-Job-Dedup auf `package_validate_blueprint_variants` (pending|processing).
  - Idempotency: `var_appr_bridge:<pkg>:<YYYYMMDDHH>` (1 Job pro Paket pro Stunde).
  - Payload-SSOT: **Pflicht `curriculum_id`** (sonst guard_job_payload P0001).
  - Audit `variant_approval_bridge_enqueued`.
- Bulk `fn_auto_dispatch_variant_approval_bridge()` (WIP-Cap 5 Pakete/Lauf).
- **Cron 242** `variant-approval-bridge-30min` (`*/30 * * * *`).

# DAG-Kontext
`generate_blueprint_variants → validate_blueprint_variants → promote_blueprint_variants → generate_exam_pool`.
Bridge enqueued nur den Validate-Step; Promote läuft via Auto-Continuation nach erfolgreichem Validate.
package_steps wird **nicht** zurückgesetzt — Job läuft als legitimer Re-Run gegen done-Step (analog
`targeted_blueprint_fill`/`repair_lf_coverage`).

# Smoke (2026-05-15)
- Reklassifizierung b064: LF03/LF11/LF12 = AWAITING_APPROVAL (51/5884/4765 review).
- Reklassifizierung 5d74: LF09 → QUESTION_GAP_ONLY (1 approved, 11 q, def 4); LF10/LF11 = AWAITING_APPROVAL (2449/2077).
- Bridge-Smoke: b064 → job a55f9bb1 (12 LFs, 11168 review), 5d74 → job fb2c9758 (2 LFs, 4526 review).

# Why this matters
Das eigentliche systemweite Bottleneck ist die Variant-Approval-Pipeline (255k review vs. 10k approved).
Bridge ist die erste skalierbare Heilroutine; Cron 242 wird die WIP-5-Pakete-Welle stündlich abarbeiten.
QUESTION_GAP_ONLY-Fälle benötigen einen separaten Question-Materialization-Pfad (offen).
