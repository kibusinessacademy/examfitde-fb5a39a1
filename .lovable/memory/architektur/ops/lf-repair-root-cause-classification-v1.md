---
name: LF-Repair Root-Cause Klassifikation v1
description: fn_classify_lf_repair_root_cause(package_id) leitet aus v_exam_pool_lf_repair_gap_classification 5 Subcodes ab (LF_REPAIR_NO_BLUEPRINTS, LF_REPAIR_NO_EFFECT, LF_REPAIR_MATERIALIZED_BUT_STILL_FAILING, LF_REPAIR_GATE_SOURCE_DRIFT, LF_REPAIR_NO_DATA). View v_lf_repair_hotloops_classified joined Hotloops + Klassifikation. RPC admin_get_lf_repair_hotloop_classifications. AFTER UPDATE Trigger trg_audit_lf_repair_failure_classified schreibt jeden Repair-Fail mit Subcode + Pflicht-Meta in auto_heal_log. Quarantine bleibt nur Loop-Stop, NIE Lösung.
type: feature
---

## Befund 2026-05-15
- 6/6 ≥20-Hotloops via Cron 240 quarantinet (manuell getriggert).
- LF-Repair Hotloops b064f0c5 (247 fails, LF03/LF11/LF12) und 5d74dcbf (170 fails, LF09/LF10/LF11): beide **LF_REPAIR_NO_EFFECT**.
- Root: gap_class=VARIANT_GAP mit usable_variant_count=0 trotz 59-60 BPs in den Lücken — `package_repair_exam_pool_lf_coverage` kann strukturell nicht materialisieren.
- Empfehlung pro Audit: Variant-Generator (blueprint→variants), NICHT Coverage-Repair re-enqueuen.

## Subcode-Logik
- alle gap_class=OK aber Gate failed → GATE_SOURCE_DRIFT
- nur BLUEPRINT_GAP → NO_BLUEPRINTS (targeted_blueprint_fill)
- VARIANT_GAP mit usable_variant_count=0 → NO_EFFECT
- QUESTION_GAP_ONLY mit approved>0 → MATERIALIZED_BUT_STILL_FAILING
- MIXED_GAP → NO_EFFECT (Variant+Question Pipeline nötig)

## Verifikation
| check | value |
|---|---|
| ≥20-Hotloops quarantinet | 6/6 |
| LF-Repair Hotloops klassifiziert | 4/4 (b064f0c5×2, 5d74dcbf×2) |
| auto_heal_log lf_repair_failure_classified backfilled | 2 |
| GATE_NOT_PASS ohne Subcode | 0 |
