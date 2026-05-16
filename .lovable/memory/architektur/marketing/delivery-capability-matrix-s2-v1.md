---
name: Delivery Capability Matrix Sprint 2 v1
description: Track-aware delivery readiness (v2) — fn_delivery_capability_matrix SSOT, v_package_delivery_readiness_v2, customer_safe v1 rewired. Baseline 190/190 customer_safe nach Sprint 2.
type: feature
---

# Sprint 2: Track-Aware Delivery Capability Matrix

## Problem (vor Sprint 2)
`v_course_delivery_readiness.delivery_ready` verlangte global `minichecks_ready` AND `exam_trainer_ready` AND `tutor_context_ready`. Für `EXAM_FIRST` (167 Pakete) ist `minichecks` aber konzeptionell **nicht erforderlich** → 163/190 falsch als `delivery_ready=false` markiert.

## Lösung
SSOT-Capability-Matrix pro Track. Delivery-Readiness wird **kapazitätsbasiert** ausgewertet (TRUE wenn `nicht required` ODER erfüllt).

### `fn_delivery_capability_matrix(_track text) → jsonb` (IMMUTABLE)

| Track | lessons | minichecks | exam_pool | tutor_context | oral | h5p | storage |
|---|---|---|---|---|---|---|---|
| EXAM_FIRST | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ |
| EXAM_FIRST_PLUS | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ |
| AUSBILDUNG_VOLL | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| STUDIUM | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |
| Default | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ |

`lessons_ready`-Signal fehlt aktuell — treated as TRUE bis dedizierte Lesson-Readiness existiert (future v3).

### Views
- **`v_package_delivery_readiness_v2`** — kapazitätsbasiert, exposes `caps`, `cap_*_ok`-Flags, `delivery_ready_v2`, `blocking_reasons_v2`. Service-role only.
- **`v_package_customer_safe_v1`** — neu verdrahtet auf v2 (Spalten unverändert, jetzt mit `track` und `delivery_caps` in `sub_flags`).

### RPC
`admin_get_delivery_matrix_summary()` — Track-Breakdown für Cockpit (has_role admin).

## Baseline 2026-05-16 (nach Sprint 2)
- customer_safe: **27 → 190 / 190** (+163)
- delivery_ready_v2: 190/190
- entitlement_ready: 190/190 (Sprint 1)
- sellable: 190/190 (M9.3)

### Per-Track
- EXAM_FIRST: 167/167
- EXAM_FIRST_PLUS: 9/9
- AUSBILDUNG_VOLL: 14/14

## Architektur-Gewinn
Hardcoded Track-Wissen ist aus RPCs/UI eliminiert. Neue Tracks (STUDIUM o.ä.) erfordern nur einen Matrix-Eintrag — keine View-/Code-Änderung.

## Followups
- v3: echte `lessons_ready`-Source ergänzen (curriculum_lessons + asset coverage)
- h5p/storage: derzeit hardcoded TRUE in v_course_delivery_readiness — bei AUSBILDUNG_VOLL wird das relevant, sobald echte Assets pro Track gefordert sind
- Dach-SSOT `v_package_operational_state_v1` (build/governance/commerce/customer/seo/b2b) als Sprint 3
