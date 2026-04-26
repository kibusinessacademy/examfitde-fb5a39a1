---
name: Throughput-Sanierung — NON_BUILDING Phantom-Jobs & Coverage-Gap-Loop
description: Behebt 250 Phantom-Failed-Jobs/h und 11x-Auto-Publish-Endlosschleifen — wesentliche Voraussetzungen für realen Pipeline-Throughput
type: feature
---

## Problem-Cluster (2026-04-26)
Nur **10 completed Jobs/h** trotz 250+ Jobs in der Queue. Drei orthogonale Ursachen:

1. **Phantom-Job-Flut**: `trg_atomic_enqueue` und `fn_resolve_pending_enqueue_steps` erlaubten Enqueue für Pakete in Status `queued/planning/blocked`. Pre-Enqueue-Building-Guard (P0a) wirft sie zurück, aber `ops_cancel_pending_non_building_jobs` markierte sie als `failed` (statt `cancelled`) → Health-Score crash, Queue voll.
2. **Coverage-Gap-Loop**: `package_auto_publish` lief 11× in Folge mit `COVERAGE_GAP_BELOW_TRACK_THRESHOLD` (26/36 Kompetenzen), kein Cap.
3. **Demo-Daten-Loop**: `package_generate_oral_exam` für `dd000001-...` scheiterte dauerhaft (0/15 competencies in Demo).

## Fixes
- **`fn_atomic_enqueue_on_step_queued`**: pkg_status-Filter auf `('building','quality_gate_failed')` reduziert (vorher 5 Werte).
- **`fn_resolve_pending_enqueue_steps`**: gleiche Einschränkung.
- **`ops_cancel_pending_non_building_jobs`**: setzt Jobs auf `cancelled` statt `failed` + setzt Cancel-Taxonomie-Felder.
- **Neue Funktion `fn_cap_auto_publish_coverage_gap_loop`**: kappt nach 5 Versuchen mit COVERAGE_GAP, markiert Step als `failed` mit `requires_manual_review=true`.
- **Cron `cap-auto-publish-coverage-gap-loops`**: alle 10 Min.

## Invariante
**Jobs für nicht-`building`/`quality_gate_failed` Pakete dürfen nicht entstehen.** Wenn doch, sind sie `cancelled` (nicht `failed`) und tragen `cancel_reason='ops_guard_non_building_package'`.
