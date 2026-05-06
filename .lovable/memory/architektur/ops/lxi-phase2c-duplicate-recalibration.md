---
name: LXI Phase 2c — Duplicate Gate Recalibration + Lesson-Push + MiniCheck Stall-Heal
description: gate_high_duplicates wertet nur noch suspicious_cross_blueprint_ratio>15% (war pauschal 66/66 published, jetzt 0/66). v_lxi_duplicate_quality_audit klassifiziert exact/allowed_variant/suspicious. RPCs admin_get_lxi_duplicate_quality_audit, admin_push_queued_no_lessons_preview/_to_build (Safety: kein bronze_lock, keine aktiven/recent_failed Jobs, WIP-Cap 60). fn_lxi_minichecks_stall_heal cron */10min, terminal nach 5 attempts.
type: feature
---

## Stand 2026-05-06

- View `v_learning_integrity_audit` neu kalibriert: gate_high_duplicates jetzt cross-blueprint based (warn-only, kein Demote, keine Repair-Jobs).
- Klassen: exact_duplicate_same_blueprint / allowed_variant_same_blueprint / suspicious_cross_blueprint.
- Vor/Nach: 66/66 → 0/66 published flagged. avg suspicious_ratio = 0%.
- 27 queued gate_no_lessons Pakete via `admin_push_queued_no_lessons_to_build(p_dry_run=false)` sicher pushbar — Eligibility-Check baked in.
- MiniCheck Stillstands-Heal alle 10min (>20min ohne update → reset_to_pending; ≥5 attempts → terminal failed). Audit `lxi_minicheck_stall_heal`.
